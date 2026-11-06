#!/usr/bin/env node
// The sole submission boundary for the authorized pilot. The preparation model never submits.
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, existsSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { browserLease } from '../engine/browser-lease.mjs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { loadProfile, workDir, resolveBrowserPath, timezone } from '../engine/config.mjs';
import { isCompanyExcluded } from '../engine/job-exclusions.mjs';
import { accountPassword } from '../engine/application-credentials.mjs';
import { serviceDebugCommand } from '../engine/employer-debug-bridge.mjs';
import { launchEmployerBrowser, finishBrowserTrial, installBrowserPlatformGuard } from '../engine/ats-browser-policy.mjs';
import { buildAutofillPlan, loadManifest, fillField, uploadFile, resolveApplicationPackage } from './apply-form-assist.mjs';
import { readJson, writeJson, readPolicy, assertCanSubmit, employerUrl, reserveSubmission, finishSubmission, applicationPaths, applicationLock, applicationIdentity } from '../engine/auto-apply.mjs';

export const RECEIPT_RE = /(?:your application (?:has been |was )?(?:successfully )?(?:submitted|received)|application submitted successfully|thank you for (?:applying|your application)|thanks for applying|we(?:'|’)ve received your application)/i;
export function safeResponseDetails(body) {
  const clean=value=>{
    if(typeof value==='string')return value.slice(0,3000).replace(/[A-Za-z0-9_-]{64,}/g,'[redacted opaque value]').replace(/((?:verification|security|one.time)\s*(?:code|password)(?:\s+is)?\s*[:=]?\s*)[A-Za-z0-9-]+/gi,'$1[redacted]').replace(/((?:password|token|secret|verification.?code|security.?code|authorization|cookie)\s*[:=]\s*)[^\s,;]+/gi,'$1[redacted]');
    if(Array.isArray(value))return value.slice(0,20).map(clean);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!/password|token|secret|authorization|cookie|otp|verification.?code|security.?code/i.test(key)).slice(0,30).map(([key,value])=>[key,clean(value)]));
    return value;
  };
  try {
    const data=JSON.parse(body),keys=['error','errors','message','detail','code','errorCode','validationErrors','fieldErrors','applicationId','application_id','success','status'];
    return clean(Object.fromEntries(keys.filter(key=>Object.hasOwn(data,key)).map(key=>[key,data[key]])));
  }catch{return {message:clean(body.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim())};}
}
export function priorApplication(metadata) {
  const l = metadata.lifecycle || {};
  return !!l.appliedAt || ['applied', 'needs_action', 'interviewing', 'closed', 'rejected', 'withdrawn'].includes(l.status);
}
export async function verifyFilledPlan(page,plan,{network=[],confirmations=[]}={}) {
  for(const field of plan.fields.filter(f=>!f.skipReason)) {
    const expected=String(field.value??'').trim();
    const matches=await Promise.all(field.selectors.map(async selector=>{
      try {
        const loc=page.locator(selector).first();
        if(field.type==='checkbox'||field.type==='radio')return await loc.isChecked()===['true','yes','1'].includes(expected.toLowerCase());
        if(field.type==='select')return (await loc.locator('option:checked').innerText()).trim()===expected||await loc.inputValue()===expected;
        return (await loc.inputValue()).trim()===expected;
      }catch{return false;}
    }));
    if(!matches.some(Boolean))throw Error('Form value does not match reviewed answer: '+field.label);
  }
  for(const file of plan.fileUploads.filter(f=>!f.skipReason)) {
    const filename=file.path.split('/').at(-1);
    const matches=await Promise.all(file.selectors.map(async selector=>{
      try{return await page.locator(selector).first().evaluate((el,name)=>[...(el.files||[])].some(file=>file.name===name),filename);}catch{return false;}
    }));
    if(!matches.some(Boolean)) {
      const confirmation=confirmations.find(f=>f.label===file.label)?.confirmation;
      let confirmed=false;
      if(confirmation?.url&&confirmation?.message) {
        const expected=employerUrl(confirmation.url);
        if(expected.origin!==employerUrl(plan.url).origin)throw Error('Upload confirmation must belong to the employer form origin');
        const response=network.some(r=>r.method==='POST'&&r.status>=200&&r.status<300&&r.url===expected.origin+expected.pathname);
        const filenameVisible=await page.getByText(filename,{exact:true}).first().isVisible();
        const successVisible=await page.getByText(confirmation.message,{exact:true}).first().isVisible();
        confirmed=response&&filenameVisible&&successVisible;
      }
      if(!confirmed)throw Error('Reviewed upload is not present: '+file.label);
    }
  }
}
export async function installApplicationNetworkPolicy(context, work, jobId, origins = [], profileId) {
  await context.route('**/*', async route => {
    const request = route.request();
    try {
      if (/(^|\.)linkedin\.com$/i.test(new URL(request.url()).hostname)) return await route.abort('blockedbyclient');
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        const current = readPolicy(work);
        if (!current.enabled || !current.autoSubmit) return await route.abort('blockedbyclient');
        if(jobId)assertCanSubmit({work,jobId,profileId:profileId || current.profileId,policy:current});
        const allowed=new Set([...origins,...(current.allowedApplicationOrigins?.[jobId]||[])].map(value=>employerUrl(value).origin));
        if(!allowed.has(new URL(request.url()).origin))return await route.abort('blockedbyclient');
      }
      await route.fallback();
    } catch { await route.abort('blockedbyclient'); }
  });
}
export function assertNoPriorRequisition(work, jobId, metadata) {
  const state = readJson(applicationPaths(work).state, { jobs: [] });
  const attempts = readJson(applicationPaths(work).journal, {attempts:[]}).attempts;
  for (const attempt of attempts.filter(a => ['submitted','submitting','uncertain'].includes(a.status))) {
    const other = readJson(join(work, 'inbox', attempt.jobId, 'metadata.json'), {});
    if (applicationIdentity(metadata) === (attempt.identity || applicationIdentity(other))) throw Error('This employer requisition already has an application or uncertain submission');
  }
  for (const dir of readdirSync(join(work, 'inbox'), {withFileTypes:true}).filter(d=>d.isDirectory())) {
    if (dir.name === jobId) continue;
    const m = readJson(join(work, 'inbox', dir.name, 'metadata.json'), {});
    const job = state.jobs.find(j=>j.id===dir.name);
    const same = applicationIdentity(metadata) === applicationIdentity(m);
    if (same && (priorApplication(m) || ['submitted', 'uncertain', 'submitting'].includes(job?.status))) throw Error('This employer requisition already has an application or uncertain submission');
  }
}
// Explicit opt-in local endpoint; never discover, restart or copy a user's profile.
export function existingBrowserFactoryFromFile(path) {
  const [port, socket] = readFileSync(resolve(path),'utf8').trim().split('\n');
  if (!/^\d+$/.test(port) || Number(port) > 65535 || !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(socket || '')) throw Error('Invalid local Chrome endpoint file');
  return async () => {
    const browser = await chromium.connectOverCDP(`ws://127.0.0.1:${port}${socket}`, {timeout:180000});
    const context = browser.contexts()[0];
    if (!context) { await browser.close(); throw Error('Prepared Chrome has no existing profile context'); }
    const page = await context.newPage();
    return {newContext:async()=>({route:(...args)=>page.route(...args),newPage:async()=>page}),close:async()=>{await page.close();await browser.close();}};
  };
}
export const validatePreparedApplication = (path, options = {}) => submitApplication(path, {...options, dryRun:true});
export async function submitApplication(manifestPath, { work = workDir(), profile = loadProfile(), dryRun = false,
  browserFactory = options => chromium.launch(options),
  recordApplied, receiptTimeoutMs = 45000, assistForm, existingBrowser = false } = {}) {
  const manifest = loadManifest(manifestPath, work), jobId = String(manifest.jobId || '');
  let policy = readPolicy(work);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(jobId) || policy.profileId !== profile.profileId || !policy.jobIds.includes(jobId)) throw Error('Job outside profile/scope');
  if (!dryRun) policy = assertCanSubmit({ work, jobId, profileId: profile.profileId });
  employerUrl(manifest.url);
  const metadata = readJson(join(work, 'inbox', jobId, 'metadata.json'));
  if (!metadata || isCompanyExcluded(metadata.company, profile) || priorApplication(metadata)) throw Error('Excluded, unavailable, or previously submitted job');
  assertNoPriorRequisition(work, jobId, metadata);
  if (manifest.employerEvidence?.exactRequisitionVerified !== true || !manifest.employerEvidence?.source || !manifest.employerEvidence?.requisitionId) throw Error('Exact employer requisition evidence is required');
  if (employerUrl(manifest.employerEvidence.source).href !== employerUrl(metadata.applyUrl).href) throw Error('Employer evidence must match saved exact source');
  if (metadata.employerRequisitionId && metadata.employerRequisitionId.toLowerCase() !== String(manifest.employerEvidence.requisitionId).toLowerCase()) throw Error('Wrong employer requisition');
  if (manifest.url !== manifest.employerEvidence.source && manifest.url !== manifest.employerEvidence.applyUrl) throw Error('Application URL must be the reviewed exact source or application URL');
  const directory = resolveApplicationPackage(manifest.applicationPackage, work), review = readJson(join(directory, 'review.json'));
  if (review?.passed !== true || review?.visualReviewed !== true || review?.sourceGrounded !== true || review?.hardChecksPassed !== true) throw Error('Package needs source-grounded, visual and HARD-check review');
  const resumePath = join(directory, 'resume.md');
  for (const path of [resumePath, join(directory,'review.json')]) if (!realpathSync(path).startsWith(realpathSync(directory) + '/')) throw Error('Review/source must stay within application package');
  const hash = value => createHash('sha256').update(value).digest('hex');
  if (review.resumeSha256 !== hash(readFileSync(resumePath))) throw Error('Resume changed after package review');
  if (![...(manifest.fileUploads || []), ...(manifest.steps || []).flatMap(s=>s.fileUploads || [])].some(f => /\.pdf$/i.test(f.path || f.file || ''))) throw Error('Resume PDF upload is required');
  let secretValues = {};
  if (manifest.account) {
    if (policy.accounts !== 'allow') throw Error('Employer account use/creation needs user authorization');
    const origin = employerUrl(manifest.account.origin);
    if (origin.hostname !== employerUrl(manifest.url).hostname) throw Error('ATS account must belong to the application host');
    secretValues = {'credential.password': dryRun ? '[keychain credential]' : accountPassword({origin:origin.origin,profileId:profile.profileId,email:profile.contact.email,createIfMissing:manifest.account.createIfMissing===true})};
  }
  const flat = manifest.steps?.length ? {...manifest, fields:manifest.steps.flatMap(s=>s.fields || []), fileUploads:manifest.steps.flatMap(s=>s.fileUploads || [])} : manifest;
  const plan = buildAutofillPlan({ manifest:flat, profile, work, secretValues });
  if (plan.unresolved.length) throw Error('Required answers or uploads unresolved: ' + plan.unresolved.join('; '));
  for (const field of plan.fields) {
    if (field.skipReason) continue;
    if (typeof field.value === 'string' && /needs review|pending confirmation|unknown|confirm if different/i.test(field.value)) throw Error(`Unconfirmed value for ${field.label}`);
    if (!manifest.answerSources?.[field.label]) throw Error(`Answer provenance missing: ${field.label}`);
    if ((field.type==='password'||/password/i.test(field.label)) && field.source!=='credential.password') throw Error('Passwords must come from the keychain, not manifest text');
    if (/guess|unknown|unconfirmed/i.test(manifest.answerSources[field.label])) throw Error(`Unconfirmed answer provenance: ${field.label}`);
    if (field.source === 'ats.legallyAbleToWork') throw Error('Use country-specific work authorization');
    if (/agree|consent|privacy|terms/i.test(field.label) && [true,'yes','true'].includes(typeof field.value==='string'?field.value.toLowerCase():field.value) && policy.requiredTerms!=='allow') throw Error('Required consent needs user authorization');
  }
  if (!manifest.submit?.selector) throw Error('Final submit selector is required');
  for (const file of plan.fileUploads) if (file.required && !existsSync(file.path)) throw Error('Upload missing');
  const pdfs = plan.fileUploads.filter(f => /\.pdf$/i.test(f.path));
  for (const pdf of pdfs) if (review.pdfHashes?.[pdf.path.split('/').at(-1)] !== hash(readFileSync(pdf.path))) throw Error('PDF changed after package review');
  if (dryRun) return { status: 'ready', jobId, url: plan.url };
  browserLease(work);
  if (policy.browserProfilePreference === 'normal_existing_profile' && !existingBrowser) throw Error('Normal Chrome profile requested; configured existing-browser adapter required');
  const manifestHash = hash(readFileSync(manifestPath));
  const reviewHash = hash(readFileSync(join(directory,'review.json')));
  const assertUnchanged = () => {
    if (hash(readFileSync(manifestPath)) !== manifestHash || hash(readFileSync(join(directory,'review.json'))) !== reviewHash || hash(readFileSync(resumePath)) !== review.resumeSha256 || pdfs.some(pdf => hash(readFileSync(pdf.path)) !== review.pdfHashes[pdf.path.split('/').at(-1)])) throw Error('Package or manifest changed after preflight');
  };
  // Recheck deterministic resume gates independently of the preparation model's review.
  execFileSync(process.execPath,[resolve('scripts/score-resume.mjs'),'--source',resumePath,'--pdf',pdfs[0].path],{encoding:'utf8',timeout:120000});
  const release = applicationLock(work, 'submission');
  let browser,page;
  const network=[],responseReads=[];
  let selection, browserError;
  let attempt;
  const evidenceRoot = join(applicationPaths(work).root, 'evidence', jobId);
  try {
    ({browser,selection}=await launchEmployerBrowser({work,url:plan.url,executablePath:resolveBrowserPath(),browserFactory,existingBrowser}));
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    await installApplicationNetworkPolicy(context, work, jobId, [employerUrl(plan.url).origin], profile.profileId);
    await installBrowserPlatformGuard(context,{work,selection});
    page = await context.newPage();
    page.on('response',response=>{
      const request=response.request();if(request.method()==='GET'&&response.status()<400)return;
      const url=new URL(response.url()),entry={at:new Date().toISOString(),method:request.method(),url:url.origin+url.pathname,status:response.status(),stage:attempt?'after_submit':'preflight'};network.push(entry);
      if(response.status()>=400||request.method()==='POST'&&/submit|applications?\b/i.test(url.pathname))responseReads.push(response.text().then(body=>{entry.response=safeResponseDetails(body);entry.retryAfter=response.headers()['retry-after']||null;}).catch(()=>{}));
      if(network.length>150)network.shift();
    });
    page.on('requestfailed',request=>{const url=new URL(request.url());network.push({at:new Date().toISOString(),method:request.method(),url:url.origin+url.pathname,failure:request.failure()?.errorText,stage:attempt?'after_submit':'preflight'});});
    await page.goto(plan.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500); employerUrl(page.url());
    if (RECEIPT_RE.test(await page.locator('body').innerText())) throw Error('Receipt text was present before submission; inspect manually');
    const actions = [];
    const steps = manifest.steps?.length ? manifest.steps : [{ fields: manifest.fields, fileUploads: manifest.fileUploads, clickBeforeFill: manifest.clickBeforeFill }];
    for (const step of steps) {
      for (const click of step.clickBeforeFill || []) {
        if (/submit|send application|finish application|complete application/i.test(click.label || click.selector)) throw Error('Submit is only allowed at the final boundary');
        const target=page.locator(click.selector).first(),label=await target.innerText();
        if (/create account|sign up|register|log in|sign in/i.test(label) && readPolicy(work).accounts!=='allow') throw Error('Account action is not authorized');
        await target.click(); await page.waitForTimeout(1000); employerUrl(page.url());
      }
      const stepPlan = buildAutofillPlan({ manifest: { ...manifest, fields: step.fields || [], fileUploads: step.fileUploads || [] }, profile, work, secretValues });
      for (const field of stepPlan.fields) {
        if (field.type === 'radio') {
          try { await page.locator(field.selectors[0]).check(); actions.push({ label: field.label, status: 'ok' }); }
          catch (error) { actions.push({label:field.label,status:field.required?'error':'skipped',detail:error.message}); }
        } else if (field.type === 'combobox') {
          try {
            const loc = page.locator(field.selectors[0]).first(); await loc.click({timeout:assistForm?5000:15000});
            if (await loc.evaluate(el => ['INPUT', 'TEXTAREA'].includes(el.tagName))) await loc.fill(String(field.value));
            const controls=await loc.getAttribute('aria-controls');
            const scope=controls?page.locator('[id='+JSON.stringify(controls)+']'):page;
            await scope.getByRole('option', { name: String(field.value), exact: true }).click({timeout:assistForm?5000:15000});
            await loc.press('Tab',{timeout:5000});actions.push({label:field.label,status:'ok'});
          } catch(error) { actions.push({label:field.label,status:field.required?'error':'skipped',detail:error.message}); }
        } else {
          const action=await fillField(page, field);
          if(field.source==='credential.password')action.detail=action.status==='ok'?'keychain credential filled':'credential field could not be filled';
          actions.push(action);
        }
      }
      for (const upload of stepPlan.fileUploads) actions.push(await uploadFile(page, upload));
      if(!actions.some(a=>a.status==='error')) {
        try{await verifyFilledPlan(page,stepPlan,{network,confirmations:step.fileUploads||[]});}
        catch(error){actions.push({label:'Form verification',status:'error',detail:error.message});}
      }
      if (actions.some(a => a.status === 'error')) {
        if (!assistForm) throw Error('Form filling failed: ' + actions.filter(a => a.status === 'error').map(a => a.label+': '+a.detail).join('; '));
        await assistForm({page,jobId,actions,manifestPath,work,network});
        // The desktop worker repairs this live form, never clicks final Submit.
        // Required controls and current policy are checked again below.
        for (const action of actions) if(action.status==='error') action.status='computer_reviewed';
      }
      await verifyFilledPlan(page,stepPlan,{network,confirmations:step.fileUploads||[]});
      if (step.nextSelector) {
        const label = await page.locator(step.nextSelector).innerText();
        if (/submit|send application|finish application|complete application/i.test(label)) throw Error('A step cannot submit');
        if (/create account|sign up|register|log in|sign in/i.test(label) && readPolicy(work).accounts!=='allow') throw Error('Account action is not authorized');
        await page.locator(step.nextSelector).click(); await page.waitForTimeout(1000); employerUrl(page.url());
      }
    }
    const requiredErrors = await page.evaluate(() => [...document.querySelectorAll('input,select,textarea,[aria-required="true"]')]
      .filter(el => !el.disabled && (el.getClientRects().length || el.type === 'file') && (el.required || el.getAttribute('aria-required') === 'true'))
      .filter(el => typeof el.checkValidity === 'function' ? !el.checkValidity() : !String(el.value || el.textContent || '').trim())
      .map(el => ({name:el.name,id:el.id,label:el.getAttribute('aria-label')})));
    if (requiredErrors.length) throw Error('Unfilled required controls: ' + JSON.stringify(requiredErrors));
    writeJson(join(evidenceRoot, 'preflight.json'), { jobId, url: page.url(), actions, checkedAt:new Date().toISOString() });
    await page.screenshot({ path: join(evidenceRoot, 'before-submit.png'), fullPage:true });
    // The last policy check happens after preparation, immediately before the irreversible action.
    policy = assertCanSubmit({ work, jobId, profileId: profile.profileId });
    if (isCompanyExcluded(readJson(join(work, 'inbox', jobId, 'metadata.json')).company, loadProfile())) throw Error('Employer is now excluded');
    assertUnchanged();
    assertNoPriorRequisition(work,jobId,readJson(join(work,'inbox',jobId,'metadata.json')));
    if (priorApplication(readJson(join(work,'inbox',jobId,'metadata.json')))) throw Error('Job advanced before submission');
    const button = page.locator(manifest.submit.selector);
    if (await button.count() !== 1 || !await button.isVisible() || !await button.isEnabled()) throw Error('Final control must be unique, visible and enabled');
    if (employerUrl(page.url()).origin !== employerUrl(plan.url).origin) throw Error('Final submission left reviewed employer origin');
    attempt = reserveSubmission({work,jobId,profileId:profile.profileId,url:page.url(),packageHash:manifestHash,zone:timezone()});
    assertCanSubmit({ work, jobId, profileId: profile.profileId });
    assertUnchanged();
    await button.click({timeout:15000});
    await page.waitForFunction(expression => new RegExp(expression,'i').test(document.body.innerText), RECEIPT_RE.source, {timeout:receiptTimeoutMs});
    employerUrl(page.url());
    const body = await page.locator('body').innerText(), match = body.match(RECEIPT_RE);
    if (!match || employerUrl(page.url()).origin !== employerUrl(plan.url).origin) throw Error('No reliable same-origin application confirmation');
    await page.screenshot({path:join(evidenceRoot,'receipt.png'),fullPage:true});
    const receipt={jobId,url:page.url(),confirmation:match[0],receivedAt:new Date().toISOString(),screenshot:join(evidenceRoot,'receipt.png')};
    writeJson(join(evidenceRoot,'receipt.json'),receipt);
    await Promise.race([Promise.allSettled(responseReads),new Promise(r=>setTimeout(r,2000))]);writeJson(join(evidenceRoot,'network.json'),network);
    finishSubmission(work,attempt.id,{status:'submitted',receipt});
    if(recordApplied)await recordApplied({jobId,manifest,receipt});
    else {
      execFileSync(process.execPath,[resolve('scripts/job-board.mjs'),'package-ready',jobId,'--package',manifest.applicationPackage.replace(/^applications\//,''),'--variant',manifest.variant || ''],{encoding:'utf8'});
      execFileSync(process.execPath,[resolve('scripts/job-board.mjs'),'applied',jobId,'--outcome','Submitted — verified employer receipt'],{encoding:'utf8'});
    }
    return {status:'submitted',receipt};
  } catch(error) {
    browserError=error;
    await Promise.race([Promise.allSettled(responseReads),new Promise(r=>setTimeout(r,2000))]);
    writeJson(join(evidenceRoot,'network.json'),network);
    if(page){try{await page.screenshot({path:join(evidenceRoot,'failure.png'),fullPage:true});}catch{}}
    if(attempt) {
      const journal=readJson(applicationPaths(work).journal);
      if(journal.attempts.find(a=>a.id===attempt.id)?.status==='submitting') finishSubmission(work,attempt.id,{status:'uncertain',error:error.message});
    }
    throw error;
  } finally {finishBrowserTrial({work,selection,error:browserError});await browser?.close();release();}
}
export function createFileAssistance(directory,{timeoutMs=600000}={}) {
  return async ({page,jobId,actions,manifestPath,work,network})=>{
    const requestId=randomUUID();
    writeJson(join(directory,'request.json'),{requestId,jobId,url:page.url(),manifestPath,actions,instruction:'Use command.json and command-result.json for shared DOM/network operations. Required consents are authorized by policy. Never click final Submit; return matching response.json ready only after checking values and uploads.'});
    const handled=new Set(),until=Date.now()+timeoutMs;
    while(Date.now()<until){
      assertCanSubmit({work,jobId,profileId:loadProfile().profileId});
      await serviceDebugCommand(page,directory,requestId,{work,manifestPath,network},handled);
      const response=readJson(join(directory,'response.json'),{});
      if(response.requestId===requestId){
        if(response.status!=='ready')throw Error('Computer worker blocked: '+(response.reason||'no reason'));
        return;
      }
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    throw Error('Computer repair timed out before submission');
  };
}
if(process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args=process.argv.slice(2),index=args.indexOf('--manifest');
  if(index<0)throw Error('--manifest is required');
  const endpointIndex=args.indexOf('--browser-endpoint');
  const endpointFileIndex=args.indexOf('--browser-endpoint-file');
  let browserFactory;
  if(endpointIndex>=0||endpointFileIndex>=0) {
    let endpointValue=args[endpointIndex+1];
    if(endpointFileIndex>=0){
      const [port,path]=readFileSync(resolve(args[endpointFileIndex+1]),'utf8').trim().split('\n');
      if(!/^\d+$/.test(port)||!path?.startsWith('/devtools/browser/'))throw Error('Invalid Chrome DevToolsActivePort file');
      endpointValue=`ws://127.0.0.1:${port}${path}`;
    }
    const endpoint=new URL(endpointValue);
    if(!['http:','ws:'].includes(endpoint.protocol)||!['127.0.0.1','localhost'].includes(endpoint.hostname)||endpoint.username||endpoint.password)throw Error('An explicitly prepared local Chrome endpoint is required');
    browserFactory=async()=>{
      const browser=await chromium.connectOverCDP(endpoint.href,{timeout:180000});
      const context=browser.contexts()[0];
      if(!context)throw Error('Prepared Chrome has no existing profile context');
      const page=await context.newPage();
      // Apply guards to our new employer tab only; unrelated user tabs are untouched.
      return {newContext:async()=>({route:(...args)=>page.route(...args),newPage:async()=>page}),close:async()=>{await page.close();await browser.close();}};
    };
  } else if(!args.includes('--dry-run')&&readPolicy(workDir()).browserProfilePreference==='normal_existing_profile') {
    throw Error('Normal Chrome profile requested: prepare its local browser endpoint and pass --browser-endpoint; do not silently create a blank temporary profile');
  }
  const assistIndex=args.indexOf('--computer-assist');
  const assistForm=assistIndex<0?undefined:createFileAssistance(resolve(args[assistIndex+1]));
  console.log(JSON.stringify(await submitApplication(resolve(args[index+1]),{dryRun:args.includes('--dry-run'),assistForm,...(browserFactory?{browserFactory,existingBrowser:true}:{})}),null,2));
}
