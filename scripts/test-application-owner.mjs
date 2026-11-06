#!/usr/bin/env node
// Real worker -> dispatcher -> foreground owner -> guarded browser, fictional routes only.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,symlinkSync,existsSync,readdirSync,renameSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {chromium} from 'playwright';
import {resolveBrowserPath} from '../engine/config.mjs';
const repo=resolve('.'),root=mkdtempSync(join(tmpdir(),'owner-integration-'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(readFileSync(p));
const write=(p,v)=>writeFileSync(p,JSON.stringify(v));
let browser;
try {
 const template=read(join(repo,'profiles/example/profile.json'));
 const source=readFileSync(join(repo,'profiles/example/base-resumes/resume.md'),'utf8');
 browser=await chromium.launch({headless:true,executablePath:resolveBrowserPath()});
 const page=await browser.newPage();
 const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;');
 const mid=source.indexOf('\n',Math.floor(source.length/2));
 await page.setContent('<style>body{font:10px Arial;white-space:pre-wrap}.page{break-after:page}</style><div class="page">'+escape(source.slice(0,mid))+'</div><div>'+escape(source.slice(mid))+'</div>');
 const pdf=await page.pdf({format:'A4'}); await browser.close();browser=null;
 for(const mode of ['submit','review','noexecute','uncertain','stop','revoke','hash','profile','outside','prior','alias','badack','journal','pdfhash','symlink','expired','noscope','autosubmitoff','finalrevoke','existingprofile','crash']) {
  const dir=join(root,mode),profile=join(dir,'profiles/example'),work=join(profile,'work'),pkg=join(work,'applications/Fixture');
  mkdirSync(pkg,{recursive:true});
  for(const name of ['scripts','engine','node_modules'])symlinkSync(join(repo,name),join(dir,name),'dir');
  write(join(dir,'resume-os.config.json'),{activeProfile:'example',timezone:'UTC'});
  const config={...template,pipelineHandoff:{enabled:true,contractVersion:1,mode:mode==='review'?'review-only':'policy-guarded',command:[process.execPath,join(dir,'owner.mjs')]},applicationOwner:{execute:mode!=='noexecute',command:[process.execPath,join(dir,'prepare.mjs')]}};
  write(join(profile,'profile.json'),config);
  write(join(profile,'application-policy.json'),{version:1,profileId:'example',enabled:true,autoSubmit:mode!=='autosubmitoff',jobIds:mode==='noscope'?[]:['1000','1001','1002'],maxSubmissionsPerDay:5,...(mode==='expired'?{expiresAt:'2000-01-01'}:{}),...(mode==='existingprofile'?{browserProfilePreference:'normal_existing_profile'}:{})});
  writeFileSync(join(pkg,'resume.md'),source);writeFileSync(join(pkg,'Jordan Rivera - Fixture - Resume.pdf'),pdf);
  write(join(pkg,'review.json'),{passed:true,visualReviewed:true,sourceGrounded:true,hardChecksPassed:true,resumeSha256:hash(source),pdfHashes:{'Jordan Rivera - Fixture - Resume.pdf':hash(pdf)}});
  for(const id of ['1000','1001','1002']) {
   const base=join(work,'inbox',id);mkdirSync(base,{recursive:true});
   write(join(base,'metadata.json'),{company:'Fictional Employer',title:'Product Manager',linkedinJobId:id,applyUrl:`https://employer.example.test/jobs/${id}`,...(mode==='prior'&&id==='1000'?{lifecycle:{status:'applied',appliedAt:'2026-01-01'}}:{}),...(mode==='alias'?{employerRequisitionSource:'fictional:tenant',employerRequisitionId:'same'}:{})});
   writeFileSync(join(base,'job.md'),'Fictional complete job description');
   write(join(pkg,`application-${id}.json`),{profileId:mode==='profile'?'wrong':'example',jobId:id,url:`https://employer.example.test/jobs/${id}`,applicationPackage:'applications/Fixture',employerEvidence:{exactRequisitionVerified:true,source:`https://employer.example.test/jobs/${id}`,requisitionId:mode==='alias'?'same':id},fields:[{label:'First name',selector:'#first',valueFrom:'profile.firstName'}],answerSources:{'First name':'profile.fullName'},fileUploads:[{label:'Resume',selector:'#resume',path:'Jordan Rivera - Fixture - Resume.pdf'}],submit:{selector:'#submit'}});
  }
  writeFileSync(join(dir,'prepare.mjs'),`import {readFileSync,writeFileSync} from 'node:fs';const r=JSON.parse(readFileSync(0,'utf8'));const mode=${JSON.stringify(mode)};
  if(mode==='stop')writeFileSync(r.work+'/application-stop.json','{}');
  if(mode==='revoke'){const p=r.work+'/../profile.json',v=JSON.parse(readFileSync(p));v.applicationOwner.execute=false;writeFileSync(p,JSON.stringify(v));}
  if(mode==='hash')writeFileSync(r.work+'/applications/Fixture/resume.md','tampered');
  if(mode==='pdfhash')writeFileSync(r.work+'/applications/Fixture/Jordan Rivera - Fixture - Resume.pdf','tampered');
  writeFileSync(r.outputPath,JSON.stringify({runId:mode==='badack'?'wrong':r.runId,jobId:r.jobId,status:'ready',manifest:mode==='outside'?${JSON.stringify(join(root,'outside.json'))}:'applications/Fixture/application-'+r.jobId+'.json'}));`);
  write(join(root,'outside.json'),{jobId:'1000'});
  if(mode==='symlink'){rmSync(join(pkg,'resume.md'));symlinkSync(join(repo,'profiles/example/base-resumes/resume.md'),join(pkg,'resume.md'));}
  if(mode==='journal'){mkdirSync(join(work,'runtime/auto-apply'),{recursive:true});write(join(work,'runtime/auto-apply/submissions.json'),{attempts:['1000','1002'].map(jobId=>({jobId,status:'uncertain'}))});}
  writeFileSync(join(dir,'owner.mjs'),`import assert from 'node:assert/strict';import {readFileSync,appendFileSync} from 'node:fs';
  import {chromium} from ${JSON.stringify(new URL('../node_modules/playwright/index.mjs',import.meta.url).href)};
  import {consumeApplicationHandoff} from ${JSON.stringify(new URL('./application-owner.mjs',import.meta.url).href)};
  const factory=async()=>{const real=await chromium.launch({headless:true,executablePath:${JSON.stringify(resolveBrowserPath())}});return {close:()=>real.close(),newContext:async options=>{const ctx=await real.newContext(options);await ctx.route('**/*',async route=>{const q=route.request(),u=new URL(q.url());assert.equal(u.hostname,'employer.example.test');if(${JSON.stringify(mode==='finalrevoke')} && q.method()==='GET'){const p=${JSON.stringify(join(profile,'profile.json'))},v=JSON.parse(readFileSync(p));v.applicationOwner.execute=false;await import('node:fs').then(fs=>fs.writeFileSync(p,JSON.stringify(v)));}if(q.method()==='POST'){const journal=JSON.parse(readFileSync(${JSON.stringify(join(work,'runtime/auto-apply/submissions.json'))}));assert.equal(journal.attempts.at(-1).status,'submitting');appendFileSync(${JSON.stringify(join(work,'posts'))},'POST\\n');assert(q.postDataBuffer().includes(Buffer.from('Jordan Rivera - Fixture - Resume.pdf')));return route.fulfill({contentType:'text/html',body:${JSON.stringify(mode==='uncertain'?'<h1>Validation failed</h1>':'<h1>Thank you for applying</h1>')}});}return route.fulfill({contentType:'text/html',body:'<form method="POST" action="/applications/submit" enctype="multipart/form-data"><input id="first" name="first" required><input id="resume" name="resume" type="file" required><button id="submit">Submit application</button></form>'});});return ctx;}};};
  const request=JSON.parse(readFileSync(0,'utf8'));if(${JSON.stringify(mode==='crash')})await import('node:fs').then(fs=>fs.mkdirSync(${JSON.stringify(join(work,'runtime/auto-apply/owner-runs'))}+'/'+request.runId,{recursive:true}));const result=await consumeApplicationHandoff(request,{submitOptions:{browserFactory:factory,receiptTimeoutMs:500}});const replay=await consumeApplicationHandoff(request,{submitOptions:{browserFactory:factory,receiptTimeoutMs:500}});assert.deepEqual(replay,result);console.log(JSON.stringify(result));`);
  renameSync(join(work,'inbox'),join(work,'staged'));mkdirSync(join(work,'inbox'));
  // Exercise ordinary worker entry function and real subprocess dispatch, not direct helper calls.
  writeFileSync(join(dir,'run.mjs'),`import assert from 'node:assert/strict';import {writeFileSync,existsSync,readFileSync,mkdirSync,copyFileSync} from 'node:fs';
  import {openDiscoveryQueue} from ${JSON.stringify(new URL('../engine/linkedin-discovery-queue.mjs',import.meta.url).href)};
  import {runQueuedJobs} from ${JSON.stringify(new URL('./run-linkedin-worker.mjs',import.meta.url).href)};
  const work=${JSON.stringify(work)},profile=${JSON.stringify(profile)};let q=openDiscoveryQueue({work,runCap:3});q.enqueue(['1000','1001','1002'].map(id=>({linkedinJobId:id,url:'https://www.linkedin.com/jobs/view/'+id+'/'})));q.close();
  const options={work,profile,repo:process.cwd(),runCap:3,render:()=>{},ingest:entry=>{if(entry.linkedinJobId==='1001'){assert(existsSync(work+'/runtime/auto-apply/owner-runs')||${JSON.stringify(mode==='prior')},'first job must reach owner before unrelated failure');throw Error('Unrelated extraction failure');}const id=entry.linkedinJobId;mkdirSync(work+'/inbox/'+id,{recursive:true});for(const f of ['metadata.json','job.md'])copyFileSync(work+'/staged/'+id+'/'+f,work+'/inbox/'+id+'/'+f);return {};},enrich:ids=>{for(const id of ids){const p=work+'/inbox/'+id;const m=JSON.parse(readFileSync(p+'/metadata.json'));m.enrichedAt=new Date().toISOString();writeFileSync(p+'/metadata.json',JSON.stringify(m));writeFileSync(p+'/enrichment.md','---\\njobId: '+id+'\\nenrichment:\\n  jdCompleteness: full\\n---\\n## Job Description\\nFictional complete description');}}};
  const first=runQueuedJobs(options);writeFileSync(work+'/report.json',JSON.stringify(first));runQueuedJobs({...options,runCap:1});`);
  const result=spawnSync(process.execPath,[join(dir,'run.mjs')],{cwd:dir,env:{...process.env,RESUME_OS_PROFILE:'example'},encoding:'utf8',timeout:120000});
  assert.equal(result.status,0,mode+': '+result.stderr);
  const report=read(join(work,'report.json'));
  assert.equal(report.exitCode,1,mode+' partial failure remains visible');
  const journalPath=join(work,'runtime/auto-apply/submissions.json');
  const attempts=existsSync(journalPath)?read(journalPath).attempts:[];
  const posts=existsSync(join(work,'posts'))?readFileSync(join(work,'posts'),'utf8').trim().split('\n').length:0;
  if(['submit','alias','prior'].includes(mode)) {
   if (!attempts.length) { for (const n of readdirSync(join(work,'runtime/pipeline-handoff/runs'))) { const p=join(work,'runtime/pipeline-handoff/runs',n,'owner.stderr'); if(existsSync(p)) console.error(readFileSync(p,'utf8')); } }
   assert.equal(attempts.length,mode==='submit'?2:1,mode+JSON.stringify(report));
   assert(attempts.every(a=>a.status==='submitted'));
   for(const a of attempts){assert.equal(read(join(work,'inbox',a.jobId,'metadata.json')).lifecycle.status,'applied');assert(existsSync(a.receipt.screenshot));}
   assert.equal(report.report.newReceiptConfirmedApplications,attempts.length);
  } else if(mode==='uncertain'){assert.equal(attempts.length,2,JSON.stringify(report));assert(attempts.every(a=>a.status==='uncertain'));assert.equal(report.report.newReceiptConfirmedApplications,0);}
  else if(mode==='journal'){assert.equal(attempts.length,2);assert(attempts.every(a=>a.status==='uncertain'));assert.equal(posts,0);}
  else {assert.equal(attempts.length,0,mode+JSON.stringify(report));assert.equal(posts,0);}
  assert.equal(posts,mode==='journal'?0:attempts.length,mode+' restart cannot resubmit');
  const events=readdirSync(join(work,'runtime/pipeline-handoff')).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).map(n=>read(join(work,'runtime/pipeline-handoff',n)));
  if(mode==='review'||mode==='noexecute'||mode==='revoke'||mode==='autosubmitoff')assert(events.every(e=>e.result?.outcome==='prepared'),mode+JSON.stringify(events));
  if(mode==='badack')assert(events.every(e=>e.status==='uncertain'));
  console.log('application owner '+mode+': PASS');
 }
 console.log('Normal enrichment -> configured owner -> guarded Chrome fixture PASS; journal before POST, receipt before applied, incremental failure isolation, review defaults, revocation, hash/profile/path refusals, aliases and restart protection. No employer contacted.');
} finally {await browser?.close();rmSync(root,{recursive:true,force:true});}
