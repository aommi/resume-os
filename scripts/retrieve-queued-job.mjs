#!/usr/bin/env node
// Mechanical retrieval stages. Ambiguous source interpretation stays in job-search-sweep.md.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workDir } from '../engine/config.mjs';
import { validateDiscoveryJob } from '../engine/linkedin-discovery-queue.mjs';
import { extractJobPostings, matchJobPosting, externalJobUrl, employerPostingKey } from '../engine/job-posting-data.mjs';
import { findExactJobDuplicate, resolveJobIdentity } from '../engine/job-identity.mjs';
import { isCompanyExcluded } from '../engine/job-exclusions.mjs';

function save(path, value) {
  mkdirSync(join(path, '..'), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); renameSync(temp, path);
}
export function fetchEmployer(url) {
  const safe = externalJobUrl(url); if (!safe) throw new Error('Invalid external job URL');
  const output = execFileSync('curl', ['--silent', '--show-error', '--location', '--max-redirs', '3', '--proto', '=https', '--proto-redir', '=https', '--max-time', '25', '--max-filesize', '4194304', '--write-out', '\n%{http_code}', safe],
    { encoding: 'utf8', timeout: 30000, maxBuffer: 5 * 1024 * 1024 });
  const split = output.lastIndexOf('\n');
  return { status: Number(output.slice(split + 1)), html: output.slice(0, split) };
}
export async function retrieveQueuedJob(entry, { work = workDir(), resolveDetail, fetchPage = fetchEmployer, now = () => new Date() } = {}) {
  validateDiscoveryJob(entry);
  if (existsSync(join(work, 'linkedin-stop.json'))) throw new Error('LINKEDIN_AUTH_REQUIRED: shared stop requires manual review');
  if (isCompanyExcluded(entry.company || '')) return { excluded: true };
  const inbox = join(work, 'inbox');
  const prior = [];
  if (existsSync(inbox)) for (const d of readdirSync(inbox, { withFileTypes: true })) {
    const path = join(inbox, d.name, 'metadata.json');
    if (!d.isDirectory() || !existsSync(path)) continue;
    try {
      const metadata = JSON.parse(readFileSync(path, 'utf8'));
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Expected metadata object');
      prior.push({ id: d.name, metadata });
    }
    catch { throw new Error(`CANONICAL_METADATA_INVALID: repair inbox/${d.name}/metadata.json`); }
  }
  const alias = prior.find(j => Array.isArray(j.metadata.linkedinAliases) && j.metadata.linkedinAliases.includes(entry.linkedinJobId));
  let duplicate = alias ? { job: alias } : findExactJobDuplicate({ id: '__incoming__', metadata: entry }, prior, { preferExisting: true });
  if (duplicate) return { duplicate: true, duplicateOf: duplicate.job.id };
  const statePath = join(work, 'runtime', 'retrieval', `${entry.linkedinJobId}.json`);
  let state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { linkedinJobId: entry.linkedinJobId, stages: [] };
  if (state.linkedinJobId !== entry.linkedinJobId || !Array.isArray(state.stages)) throw new Error('Retrieval state identity mismatch or invalid stages');
  const record = (stage, result) => { state.stages.push({ stage, result, at: now().toISOString() }); state.stages = state.stages.slice(-12); save(statePath, state); };
  if (!state.detail) {
    if (externalJobUrl(entry.applyUrl) && entry.sourceEvidence?.linkedinJobId === entry.linkedinJobId) {
      state.detail = { applyUrl: entry.applyUrl, sourceEvidence: entry.sourceEvidence };
    } else {
      resolveDetail ??= (await import('../engine/linkedin-selected-detail.mjs')).resolveLinkedInDetail;
      state.detail = await resolveDetail(entry);
    }
    if (state.detail.sourceEvidence?.linkedinJobId !== entry.linkedinJobId) throw new Error('Detail source identity mismatch');
    record('resolve-link', 'verified');
  }
  if (state.detail?.sourceEvidence?.linkedinJobId !== entry.linkedinJobId) throw new Error('Persisted detail source identity mismatch');
  const applyUrl = externalJobUrl(state.detail.applyUrl);
  const identity = resolveJobIdentity({ ...entry, applyUrl });
  const sameEmployerUrl = applyUrl && entry.company?.trim() && prior.find(j => j.metadata.employerPostingUrl === employerPostingKey(applyUrl) &&
    j.metadata.company?.trim().toLowerCase() === entry.company?.trim().toLowerCase());
  if (sameEmployerUrl) return { duplicate: true, duplicateOf: sameEmployerUrl.id };
  duplicate = findExactJobDuplicate({ id: '__incoming__', metadata: { ...entry, ...identity, applyUrl } }, prior, { preferExisting: true });
  if (duplicate) return { duplicate: true, duplicateOf: duplicate.job.id };
  let posting = null;
  if (applyUrl) {
    try {
      const response = await fetchPage(applyUrl);
      if (response.status === 429) { record('employer-http', 'rate_limited'); throw Object.assign(new Error('Employer rate limited; defer without browser retry'), { code: 'EMPLOYER_RATE_LIMITED' }); }
      if (response.status === 200) posting = matchJobPosting(extractJobPostings(response.html), entry);
      record('employer-http', posting ? 'structured_verified' : `needs_skill_review:${response.status}`);
    } catch (error) {
      if (error.code === 'EMPLOYER_RATE_LIMITED') throw error;
      record('employer-http', 'transport_failed');
    }
  }
  const dir = join(inbox, entry.linkedinJobId); mkdirSync(dir, { recursive: true });
  const description = posting?.description || state.detail.description || '';
  const metadata = { ...entry, ...identity, title: posting?.title || entry.title || state.detail.title || '', company: posting?.company || entry.company || state.detail.company || '',
    applyUrl, description, sourceEvidence: state.detail.sourceEvidence, fetched: now().toISOString().slice(0, 10),
    retrieval: { status: posting ? 'structured_verified' : 'needs_skill_review', evidencePath: statePath, employerIdentifier: posting?.requisitionId || null },
    lifecycle: { status: 'to_review' }, saved: false, saveAttempted: false };
  // A scoped requisition already present in structured data can be retained separately from an ATS URL ID.
  if (posting?.requisitionId) metadata.sourceRequisitionId = posting.requisitionId;
  writeFileSync(join(dir, 'job.md'), `# ${metadata.company} — ${metadata.title}\n\n- Source: ${entry.url}\n- Apply URL: ${applyUrl || '(not resolved)'}\n\n## Job Description\n\n${description || '(Pending source extraction; not a completed description.)'}\n`, { mode: 0o600 });
  if (posting) {
    writeFileSync(join(dir, 'enrichment.md'), `---\njobId: ${JSON.stringify(entry.linkedinJobId)}\nenrichment:\n  jdCompleteness: partial\n  applicationQuestionsRetrieved: false\n  applyUrlVerified: true\n---\n\n## Job Description\n\n${description}\n\n## Source\n\n${applyUrl}\nExtracted from employer JobPosting structured data; exact identity fields matched the source card. Source completeness has not been independently checked.\n\n## Application Questions\n\nNot retrieved.\n`, { mode: 0o600 });
    metadata.employerPostingUrl = employerPostingKey(applyUrl);
    metadata.enrichedAt = now().toISOString();
    metadata.atsType = 'structured';
  }
  save(join(dir, 'metadata.json'), metadata);
  record('canonical-write', posting ? 'complete' : 'skill_pending');
  return metadata;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await retrieveQueuedJob(JSON.parse(readFileSync(0, 'utf8'))))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
