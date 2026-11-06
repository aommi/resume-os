// Durable stage handoff only. Screening, tailoring and application guards belong
// to the configured owner/markdown; enriched never means application-ready.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig, profileDir, workDir } from './config.mjs';
import { resolveJobIdentity } from './job-identity.mjs';
import { isEnrichmentComplete } from './enrichment-completion.mjs';
import { acquireProcessLock } from './process-lock.mjs';

const wrapper = fileURLToPath(new URL('../scripts/with-browser-ownership.py', import.meta.url));
const read = path => JSON.parse(readFileSync(path, 'utf8'));
function atomic(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temp, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fsyncSync(fd); }
  finally { closeSync(fd); }
  renameSync(temp, path);
}
function directory(work) {
  const dir = join(work, 'runtime', 'pipeline-handoff');
  mkdirSync(dir, { recursive: true });
  return dir;
}
export function browserOwnershipPath(work = workDir()) {
  // Profiles sharing a desktop must configure the SAME absolute path.
  return resolve(loadConfig().browser?.ownershipLock || join(work, 'locks', 'shared-browser.lock'));
}
export function browserCommand(file, args, options = {}, { work = workDir(), gate = [] } = {}) {
  return execFileSync('python3', [wrapper, '--lock', browserOwnershipPath(work), ...gate, '--', file, ...args], options);
}
export function handoffConfigured(profile = profileDir()) {
  const path = join(profile, 'profile.json');
  return existsSync(path) && read(path).pipelineHandoff?.enabled === true;
}
export function recordEnrichedHandoff({ work, jobId }) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(jobId)) throw new Error('Invalid canonical inbox ID');
  const base = join(work, 'inbox', jobId), metadata = read(join(base, 'metadata.json'));
  if (!isEnrichmentComplete(base, metadata)) throw new Error('Handoff requires complete enrichment');
  const identity = resolveJobIdentity(metadata);
  const identityKey = (value, fallback) => value.employerRequisitionSource && value.employerRequisitionId
    ? ['employer', value.employerRequisitionSource.toLowerCase(), value.employerRequisitionId.toLowerCase()]
    : ['linkedin', value.linkedinJobId || fallback];
  // Match existing exact identity semantics (case-insensitive requisition IDs).
  // Also retain a claim if later enrichment adds employer identity to the SAME
  // canonical job; changing source facts must not silently replay consumption.
  const key = identityKey(identity, jobId);
  const dir = directory(work), release = acquireProcessLock(join(dir, 'state.lock'));
  try {
    const existing = readdirSync(dir).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).find(name => {
      const event = read(join(dir, name));
      return event.jobIds.includes(jobId) || JSON.stringify(identityKey(event.identity, event.jobIds[0])) === JSON.stringify(key);
    });
    const path = join(dir, existing || createHash('sha256').update(JSON.stringify(key)).digest('hex') + '.json');
    const previous = existsSync(path) ? read(path) : null;
    if (previous) {
      previous.jobIds = [...new Set([...previous.jobIds, jobId])];
      if (identity.employerRequisitionId) previous.identity = identity;
      atomic(path, previous);
    } else atomic(path, { version: 1, stage: 'enriched', status: 'pending', jobIds: [jobId], identity, createdAt: new Date().toISOString() });
    return path;
  } finally { release(); }
}

export function dispatchHandoffs({ work = workDir(), profile = profileDir(), repo = process.cwd() } = {}) {
  const dir = directory(work), summary = { consumed: [], held: [], uncertain: [], pending: [], newReceiptConfirmedApplications: 0 };
  let release;
  try { release = acquireProcessLock(join(dir, 'state.lock')); }
  catch (error) { if (error.code === 'RESOURCE_LOCKED') return { ...summary, busy: true }; throw error; }
  try {
    for (const name of readdirSync(dir).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort()) {
      const path = join(dir, name), event = read(path);
      if (event.status === 'running') {
        // Previous scheduler died. Never relaunch an unacknowledged owner.
        event.status = 'uncertain'; event.error = 'Owner completion not acknowledged; reconcile saved run before retry'; atomic(path, event);
      }
      if (event.status !== 'pending') { if (event.status === 'uncertain') summary.uncertain.push(event.jobIds); continue; }
      const configPath = join(profile, 'profile.json'), policyPath = join(profile, 'application-policy.json');
      const config = existsSync(configPath) ? read(configPath).pipelineHandoff : null;
      const policy = existsSync(policyPath) ? read(policyPath) : {};
      const stops = [join(work, 'pipeline-stop.json'), join(work, 'linkedin-stop.json')];
      if (config?.enabled !== true || policy.enabled !== true || policy.paused === true || stops.some(existsSync)) {
        summary.pending.push(event.jobIds); continue;
      }
      if (config.contractVersion !== 1 || !Array.isArray(config.command) || !config.command.length || config.command.some(arg => typeof arg !== 'string' || !arg)) throw new Error('pipelineHandoff requires contractVersion:1 and a nonempty command argv');
      const timeout = config.timeoutMs ?? 900000;
      if (!Number.isSafeInteger(timeout) || timeout < 1) throw new Error('Invalid pipelineHandoff.timeoutMs');
      // Lifecycle is canonical. The owner still reconciles journal/exact duplicates
      // and performs all judgment; no lifecycle writes happen in this module.
      const active = event.jobIds.filter(id => {
        const metadata = read(join(work, 'inbox', id, 'metadata.json'));
        return !['applied', 'interviewing', 'needs_action', 'closed', 'skipped'].includes(metadata.lifecycle?.status) && !metadata.lifecycle?.appliedAt;
      });
      if (active.length !== event.jobIds.length) { event.status = 'held'; event.reason = 'An exact-job alias has already advanced in canonical lifecycle'; atomic(path, event); summary.held.push(event.jobIds); continue; }
      event.runId = randomUUID(); event.status = 'running'; event.startedAt = new Date().toISOString();
      const runDir = join(dir, 'runs', event.runId); mkdirSync(runDir, { recursive: true });
      const request = { version: 1, runId: event.runId, stage: 'enriched', mode: 'review-only', jobIds: active,
        work, policyPath, instruction: 'Read pipeline-handoff.md. Screening and tailoring judgment precede readiness. This handoff does not authorize submission.' };
      atomic(join(runDir, 'request.json'), request);
      event.runDir = runDir;
      atomic(path, event); // Claim before launching: ambiguous exits are never retried automatically.
      try {
        const output = browserCommand(config.command[0], config.command.slice(1), { cwd: repo, input: JSON.stringify(request), encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] },
          { work, gate: ['--config', configPath, '--policy', policyPath, ...stops.flatMap(p => ['--stop', p])] });
        writeFileSync(join(runDir, 'owner.stdout'), output, { mode: 0o600 });
        const result = JSON.parse(output);
        if (result.runId !== event.runId || !Array.isArray(result.acceptedJobIds) || result.acceptedJobIds.length !== active.length || new Set(result.acceptedJobIds).size !== active.length || result.acceptedJobIds.some(id => !active.includes(id)) || !['prepared', 'held', 'uncertain'].includes(result.outcome)) throw new Error('Owner must acknowledge exact run/job IDs and a review-only outcome');
        event.acceptedJobIds = result.acceptedJobIds; event.result = result;
        event.status = result.outcome === 'uncertain' ? 'uncertain' : 'consumed';
        summary[event.status].push(event.acceptedJobIds);
      } catch (error) {
        // Busy/revoked are wrapper refusals before child launch, safe to leave pending.
        const refused = [75, 77].includes(error.status) && /^(BROWSER_BUSY|HANDOFF_STOPPED|HANDOFF_REVOKED)\s*$/.test(String(error.stderr).trim());
        event.status = refused ? 'pending' : 'uncertain';
        event.error = error.message;
        writeFileSync(join(runDir, 'owner.stderr'), String(error.stderr || error.message), { mode: 0o600 });
        summary[event.status].push(event.jobIds);
      }
      event.finishedAt = new Date().toISOString(); atomic(path, event);
    }
    return summary;
  } finally { release(); }
}
