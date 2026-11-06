// Persistence and execution policy only. Fit, source interpretation and tailoring live in skills.
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, fsyncSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { resolveJobIdentity } from './job-identity.mjs';
import { normalizeCompanyName } from './job-exclusions.mjs';
import { acquireProcessLock } from './process-lock.mjs';

export function isPrepareOnlyEmployer(metadata,policy) {
  const name=normalizeCompanyName(metadata?.company);
  return !!name && (policy.prepareOnlyCompanies||[]).some(company=>normalizeCompanyName(company)===name);
}

export function applicationIdentity(metadata) {
  const i = resolveJobIdentity(metadata);
  if (i.employerRequisitionId && i.employerRequisitionSource) return `${i.employerRequisitionSource.toLowerCase()}:${i.employerRequisitionId.toLowerCase()}`;
  if (metadata.applyUrl) {
    let url;
    try { url = employerUrl(metadata.applyUrl); } catch {}
    if (url) {
      url.hash = '';
      for (const key of [...url.searchParams.keys()]) if (/^utm_|^(src|source|gh_src|lever-origin|lever-source)$/i.test(key)) url.searchParams.delete(key);
      url.searchParams.sort();
      return `employer-url:${url.href.replace(/\/$/,'')}`;
    }
  }
  return `linkedin:${i.linkedinJobId}`;
}

export function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}
export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temp, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, path);
  const dir = openSync(dirname(path), 'r');
  try { fsyncSync(dir); } finally { closeSync(dir); }
}
export function applicationPaths(work) {
  const root = join(work, 'runtime', 'auto-apply');
  return { root, policy: join(work, '..', 'application-policy.json'), state: join(root, 'state.json'),
    questions: join(root, 'questions.json'), answers: join(work, '..', 'application-answers.json'),
    journal: join(root, 'submissions.json'), lock: join(root, 'worker.lock') };
}
export function persistApplicationDisposition(work,job,pilotId) {
  if(!['submitted','skipped','duplicate'].includes(job.status))throw Error('Only terminal dispositions may leave the active queue');
  const path=join(work,'inbox',job.id,'metadata.json'),metadata=readJson(path);
  if(!metadata)throw Error('Canonical inbox record missing for disposition');
  metadata.applicationPilot={pilotId,status:job.status,duplicateOf:job.duplicateOf||null,
    reason:job.reason||job.preparation?.reason||null,updatedAt:new Date().toISOString()};
  writeJson(path,metadata);
}
export function readPolicy(work) {
  const value = readJson(applicationPaths(work).policy, { version: 1, enabled: false, autoSubmit: false, jobIds: [] });
  if (value.version !== 1 || !Array.isArray(value.jobIds) || value.jobIds.some(id=>typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) || typeof value.enabled !== 'boolean' || typeof value.autoSubmit !== 'boolean') throw Error('Invalid application policy');
  for (const key of ['maxPerRun', 'maxSubmissionsPerDay']) if (value[key] !== undefined && (!Number.isSafeInteger(value[key]) || value[key] < 1)) throw Error(`Invalid ${key}`);
  if(value.prepareOnlyCompanies!==undefined&&(!Array.isArray(value.prepareOnlyCompanies)||value.prepareOnlyCompanies.some(v=>typeof v!=='string'||!v.trim())))throw Error('Invalid prepare-only companies');
  return value;
}
export function employerUrl(value, { allowLocal = false } = {}) {
  const url = new URL(value);
  if (/(^|\.)linkedin\.com$/i.test(url.hostname)) throw Error('LinkedIn is blocked for application automation');
  if (url.username || url.password || (url.protocol !== 'https:' && !(allowLocal && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))) throw Error('Application URL must use HTTPS without embedded credentials');
  return url;
}
// A posting date is evidence; fetch/enrichment timestamps never substitute for it.
export function applicationPostingFreshness(metadata, policy, now = new Date()) {
  const days = policy.maxPostingAgeDays;
  if (days === undefined) return { eligible: true, reason: 'No posting-age restriction' };
  if (!Number.isSafeInteger(days) || days < 0) throw Error('Invalid posting-age policy');
  const posted = metadata?.postedAt;
  if (typeof posted !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(posted)) {
    return { eligible: false, reason: 'Posting date missing or unverified; hold application' };
  }
  const parsed = Date.parse(posted);
  if (!Number.isFinite(parsed) || new Date(Date.parse(posted.slice(0,10))).toISOString().slice(0,10) !== posted.slice(0,10)) {
    return { eligible: false, reason: 'Posting date invalid; hold application' };
  }
  if (posted.length === 10) {
    // Date-only evidence has calendar-day precision, evaluated in the profile timezone.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: policy.postingAgeTimezone || 'UTC', year:'numeric', month:'2-digit', day:'2-digit' }).format(now);
    const cutoff = new Date(Date.parse(today) - days * 86400000).toISOString().slice(0,10);
    return { eligible: posted >= cutoff && posted <= today, postedAt: posted, cutoff, reason: posted < cutoff ? 'Posting older than allowed age' : posted > today ? 'Future posting date; hold application' : 'Posting within allowed age' };
  }
  const age = now.getTime() - parsed;
  return { eligible: age >= 0 && age <= days * 86400000, postedAt: posted, reason: age < 0 ? 'Future posting date; hold application' : age > days * 86400000 ? 'Posting older than allowed age' : 'Posting within allowed age' };
}
export function assertCanSubmit({ work, jobId, profileId, policy = readPolicy(work) }) {
  if (!policy.enabled || !policy.autoSubmit || policy.paused === true) throw Error('Auto-apply submission is disabled');
  for (const name of ['pipeline-stop.json', 'linkedin-stop.json', 'application-stop.json']) if (existsSync(join(work, name))) throw Error('Application stopped');
  const handoff = readJson(join(work, '..', 'profile.json'), {}).pipelineHandoff;
  if (process.env.RESUME_OS_OWNER_RUN && (handoff?.enabled !== true || handoff.mode !== 'policy-guarded' || readJson(join(work, '..', 'profile.json'), {}).applicationOwner?.execute !== true)) throw Error('Configured owner execution revoked');
  if (policy.profileId !== profileId || !policy.jobIds.includes(jobId)) throw Error('Job is outside the authorized pilot/profile');
  if (policy.expiresAt && (!Number.isFinite(Date.parse(policy.expiresAt)) || Date.parse(policy.expiresAt) < Date.now())) throw Error('Application policy expired');
  const metadata = readJson(join(work,'inbox',jobId,'metadata.json'),{});
  if(isPrepareOnlyEmployer(metadata,policy))throw Error('Employer is prepare-only; automatic submission is prohibited');
  const freshness = applicationPostingFreshness(metadata,policy);
  if(!freshness.eligible)throw Error(freshness.reason);
  return policy;
}
export function reserveSubmission({ work, jobId, profileId, url, packageHash, now = new Date(), zone = 'UTC' }) {
  const policy = assertCanSubmit({ work, jobId, profileId });
  employerUrl(url);
  const paths = applicationPaths(work), journal = readJson(paths.journal, { version: 1, attempts: [] });
  if (journal.attempts.some(a => a.jobId === jobId && ['submitting', 'uncertain', 'submitted'].includes(a.status))) throw Error('Submission already attempted; reconcile receipt before retrying');
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  if (journal.attempts.filter(a => a.day === day).length >= (policy.maxSubmissionsPerDay || 60)) throw Error('Daily application submission budget reached');
  const identity = applicationIdentity(readJson(join(work,'inbox',jobId,'metadata.json'),{}));
  if (journal.attempts.some(a => a.identity === identity && ['submitting','uncertain','submitted'].includes(a.status))) throw Error('Exact requisition already attempted');
  const ownerRun = process.env.RESUME_OS_OWNER_RUN || null;
  if (ownerRun && journal.attempts.filter(a=>a.ownerRun === ownerRun).length >= (policy.maxPerRun || 5)) throw Error('Run application submission budget reached');
  const attempt = { ownerRun, id: randomUUID(), jobId, profileId, identity, url, packageHash, day, status: 'submitting', startedAt: now.toISOString() };
  journal.attempts.push(attempt); writeJson(paths.journal, journal); return attempt;
}
export function finishSubmission(work, attemptId, result) {
  const path = applicationPaths(work).journal, journal = readJson(path);
  const attempt = journal.attempts.find(a => a.id === attemptId);
  if (!attempt || attempt.status !== 'submitting') throw Error('No active submission reservation');
  if (!['submitted','uncertain'].includes(result.status) || result.status === 'submitted' && (result.receipt?.jobId !== attempt.jobId || !result.receipt?.confirmation?.trim() || !result.receipt?.receivedAt)) throw Error('Submitted status requires matching receipt');
  Object.assign(attempt, result, { finishedAt: new Date().toISOString() }); writeJson(path, journal);
}
// Reconciliation records positive receipt review; it never dispatches a browser retry.
export function reconcileSubmissionReceipt(work, attemptId, receipt) {
  const path=applicationPaths(work).journal,journal=readJson(path),attempt=journal.attempts.find(a=>a.id===attemptId);
  if(!attempt||attempt.status!=='uncertain')throw Error('Only an uncertain attempt may be reconciled');
  if(receipt?.jobId!==attempt.jobId||!receipt.confirmation?.trim()||receipt.reviewedEvidence!==true||!receipt.evidence?.length)throw Error('Matching reviewed receipt evidence is required');
  Object.assign(attempt,{status:'submitted',receipt,error:null,reconciledAt:new Date().toISOString(),reconciliation:'Positive employer receipt evidence reviewed; no application retried'});
  writeJson(path,journal);return attempt;
}
export function applicationLock(work, name = 'worker') {
  if (!['worker','submission'].includes(name)) throw Error('Unknown lock scope');
  mkdirSync(applicationPaths(work).root, {recursive:true});
  return acquireProcessLock(join(applicationPaths(work).root, `${name}.lock`));
}
export function recordQuestion(work, question) {
  if (!question.question?.trim() || !question.key?.trim() || !question.context?.trim()) throw Error('Question needs key, context, and question text');
  const path = applicationPaths(work).questions, items = readJson(path, { version: 1, items: [] });
  const id = createHash('sha256').update(`${question.key}\n${question.context}`).digest('hex').slice(0, 16);
  let item = items.items.find(q => q.id === id);
  if (!item) { item = { ...question, id, status: 'open', createdAt: new Date().toISOString(), jobIds: [] }; items.items.push(item); }
  item.jobIds = [...new Set([...item.jobIds, ...(question.jobId ? [question.jobId] : [])])];
  writeJson(path, items); return item;
}
export function promoteAnswers(work) {
  const paths = applicationPaths(work), questions = readJson(paths.questions, { version: 1, items: [] });
  const durable = readJson(paths.answers, { version: 1, answers: [] }), promoted = [];
  for (const q of questions.items) {
    if (q.status !== 'confirmed' || q.source !== 'user' || q.answer === undefined) continue;
    const answer = { id: q.id, key: q.key, context: q.context, answer: q.answer, source: 'user', confirmedAt: q.confirmedAt, expiresAt: q.expiresAt || null };
    const i = durable.answers.findIndex(a => a.id === q.id); if (i < 0) durable.answers.push(answer); else durable.answers[i] = answer;
    q.status = 'promoted'; q.promotedAt = new Date().toISOString(); promoted.push(q.id);
  }
  writeJson(paths.answers, durable); writeJson(paths.questions, questions);
  return { promoted, open: questions.items.filter(q => q.status === 'open') };
}
