#!/usr/bin/env node
// Foreground bridge: configured judgment process -> validated package -> guarded executor.
import { readFileSync, realpathSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadProfile, workDir, profileDir } from '../engine/config.mjs';
import { browserLease, inheritedBrowserStdio } from '../engine/browser-lease.mjs';
import { applicationPaths, readJson, writeJson, readPolicy, applicationLock, applicationPostingFreshness, isPrepareOnlyEmployer, recordQuestion } from '../engine/auto-apply.mjs';
import { isCompanyExcluded } from '../engine/job-exclusions.mjs';
import { isEnrichmentComplete } from '../engine/enrichment-completion.mjs';
import { submitApplication, existingBrowserFactoryFromFile, priorApplication, assertNoPriorRequisition } from './submit-employer-application.mjs';

function contained(base, path) {
  if (!realpathSync(path).startsWith(realpathSync(base) + sep)) throw Error('Owner path is outside active profile work');
  return path;
}
function current(work, profile) {
  const policy = readPolicy(work);
  const handoff = readJson(join(profileDir(),'profile.json')).pipelineHandoff;
  if (['pipeline-stop.json','linkedin-stop.json','application-stop.json'].some(n=>existsSync(join(work,n)))) throw Error('Application stopped');
  if (policy.expiresAt && (!Number.isFinite(Date.parse(policy.expiresAt)) || Date.parse(policy.expiresAt) < Date.now())) throw Error('Application policy expired');
  if (!policy.enabled || policy.paused === true || policy.profileId !== profile.profileId || handoff?.enabled !== true) throw Error('Owner disabled, paused or wrong profile');
  return {policy, handoff};
}
export async function consumeApplicationHandoff(request, { submitOptions = {} } = {}) {
  const work = workDir(), profile = loadProfile();
  if (request.version !== 1 || request.stage !== 'enriched' || !/^[a-f0-9-]{36}$/.test(request.runId || '') || !Array.isArray(request.jobIds) || !request.jobIds.length || new Set(request.jobIds).size !== request.jobIds.length || request.jobIds.some(id=>! /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id))) throw Error('Invalid owner request');
  if (realpathSync(request.work) !== realpathSync(work) || realpathSync(request.policyPath) !== realpathSync(applicationPaths(work).policy)) throw Error('Wrong owner profile/work/policy path');
  browserLease(work); // Same lease as enrichment/dispatcher; never acquire a second browser.
  const release = applicationLock(work);
  const results = [], runDir = join(applicationPaths(work).root,'owner-runs',request.runId);
  if (existsSync(runDir)) {
    const saved = readJson(join(runDir,'result.json'));
    if (saved && JSON.stringify(saved.acceptedJobIds) === JSON.stringify(request.jobIds)) { release(); return saved; }
    release();
    return {runId:request.runId,acceptedJobIds:request.jobIds,outcome:'uncertain',results:[],reason:'Prior owner run has no completion acknowledgment; reconcile before retry'};
  }
  mkdirSync(runDir,{recursive:true});
  writeJson(join(runDir,'request.json'),request);
  process.env.RESUME_OS_OWNER_RUN = request.runId;
  try {
    for (const jobId of request.jobIds) {
      let phase = 'review';
      try {
        const {policy} = current(work,profile), base = contained(work,join(work,'inbox',jobId)), metadata = readJson(contained(base,join(base,'metadata.json')));
        if (!isEnrichmentComplete(base,metadata)) throw Error('Enrichment incomplete');
        if (!policy.jobIds.includes(jobId) || isCompanyExcluded(metadata.company,profile) || priorApplication(metadata)) throw Error('Job outside scope, excluded or already advanced');
        assertNoPriorRequisition(work,jobId,metadata);
        const freshness = applicationPostingFreshness(metadata,policy);
        if (!freshness.eligible) throw Error(freshness.reason);
        const config = loadProfile().applicationOwner;
        if (!Array.isArray(config?.command) || !config.command.length || config.command.some(s=>typeof s!=='string'||!s)) throw Error('applicationOwner.command argv required');
        if (config.timeoutMs !== undefined && (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1)) throw Error('Invalid applicationOwner.timeoutMs');
        const outputPath = join(runDir,jobId+'.json');
        const prompt = {version:1,runId:request.runId,jobId,work,outputPath,mode:'prepare-only',
          instruction:'Read application-automation.md and pipeline-handoff.md. Apply markdown screening/tailoring judgment to canonical sources. Write only the explicit result JSON to outputPath; no final Submit, no scope/policy edits. Return runId/jobId/status; ready requires a reviewed manifest path; held/needs_input requires a reason. Never invent receipt evidence.'};
        phase = 'operator';
        const output = execFileSync(config.command[0],config.command.slice(1),{cwd:process.cwd(),input:JSON.stringify(prompt)+'\n',encoding:'utf8',timeout:config.timeoutMs ?? 900000,maxBuffer:8*1024*1024,stdio:inheritedBrowserStdio(work)});
        writeFileSync(join(runDir,jobId+'.stdout'),output,{mode:0o600});
        const prepared = readJson(contained(runDir,outputPath));
        if (prepared.runId !== request.runId || prepared.jobId !== jobId || !['ready','held','needs_input'].includes(prepared.status)) throw Error('Judgment process did not acknowledge exact run/job and explicit state');
        current(work,profile);
        if (prepared.status !== 'ready') {
          if (!prepared.reason?.trim()) throw Error('Held/needs_input result needs reason');
          for (const q of prepared.questions || []) recordQuestion(work,{...q,jobId});
          results.push({jobId,status:'held',reason:prepared.reason}); continue;
        }
        phase = 'validation';
        const manifestPath = contained(work,resolve(work,prepared.manifest || ''));
        if (readJson(manifestPath).jobId !== jobId) throw Error('Wrong manifest job');
        const now = current(work,profile);
        // Dry validation is real guard validation, not model readiness flags.
        if (now.policy.autoSubmit !== true || request.mode !== 'policy-guarded' || now.handoff.mode !== 'policy-guarded' || loadProfile().applicationOwner?.execute !== true || isPrepareOnlyEmployer(metadata,now.policy)) {
          // Preparation-only still validates review/hashes without enabling submission.
          const { validatePreparedApplication } = await import('./submit-employer-application.mjs');
          await validatePreparedApplication(manifestPath,{work,profile});
          results.push({jobId,status:'prepared',manifest:manifestPath}); continue;
        }
        phase = 'execution';
        const endpointFile = loadProfile().applicationOwner?.browserEndpointFile;
        const transport = endpointFile ? {browserFactory:existingBrowserFactoryFromFile(endpointFile),existingBrowser:true} : {};
        const result = await submitApplication(manifestPath,{...transport,...submitOptions,work,profile});
        results.push({jobId,status:result.status,receipt:result.receipt});
      } catch (error) {
        const attempts = readJson(applicationPaths(work).journal,{attempts:[]}).attempts;
        const uncertain = phase === 'operator' || attempts.some(a=>a.jobId===jobId&&['submitting','uncertain'].includes(a.status));
        results.push({jobId,status:uncertain?'uncertain':'held',reason:error.message});
      }
    }
    const outcome = results.some(r=>r.status==='uncertain')?'uncertain':results.some(r=>r.status==='submitted')?'submitted':results.some(r=>r.status==='prepared')?'prepared':'held';
    const result = {runId:request.runId,acceptedJobIds:request.jobIds,outcome,results};
    writeJson(join(runDir,'result.json'),result);
    return result;
  } finally { delete process.env.RESUME_OS_OWNER_RUN; release(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await consumeApplicationHandoff(JSON.parse(readFileSync(0,'utf8')))));
}
