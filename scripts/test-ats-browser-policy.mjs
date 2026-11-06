import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {reserveBrowserSelection,readBrowserLedger,launchEmployerBrowser,finishBrowserTrial,installBrowserPlatformGuard,seedBrowserFailures} from '../engine/ats-browser-policy.mjs';
const work=mkdtempSync(join(tmpdir(),'ats-browser-policy-'));
try {
 const first=reserveBrowserSelection({work,url:'https://job-boards.greenhouse.io/example/jobs/1'});
 assert.equal(first.headless,true);
 assert.equal(reserveBrowserSelection({work,url:'https://boards.greenhouse.io/another/jobs/2'}).headless,false);
 finishBrowserTrial({work,selection:first,error:Error('headless blocked')});
 assert.equal(readBrowserLedger(work).platforms.greenhouse.status,'failed');
 assert.equal(reserveBrowserSelection({work,url:'https://job-boards.greenhouse.io/example/jobs/3'}).headless,false);
 assert.equal(reserveBrowserSelection({work,url:'https://careers.example.test/jobs/4'}).headless,false);
 await assert.rejects(launchEmployerBrowser({work,url:'https://jobs.lever.co/example/12345678',executablePath:'/fixture/chrome',browserFactory:async options=>{assert.equal(options.headless,true);throw Error('failed launch');}}),/failed launch/);
 assert.equal(reserveBrowserSelection({work,url:'https://jobs.lever.co/example/98765432'}).headless,false);
 let handler;await installBrowserPlatformGuard({route:async(pattern,fn)=>{handler=fn;}},{work,selection:first});
 async function nav(url){let result;await handler({request:()=>({isNavigationRequest:()=>true,url:()=>url}),abort:async()=>{result='blocked';},fallback:async()=>{result='allowed';}});return result;}
 assert.equal(await nav('https://job-boards.greenhouse.io/example/jobs/1'),'allowed');
 assert.equal(await nav('https://jobs.lever.co/example/12345678'),'blocked');
 seedBrowserFailures({work,platforms:['eightfold'],hostPlatforms:{'jobs.example.test':'eightfold'}});
 assert.equal(reserveBrowserSelection({work,url:'https://jobs.example.test/careers'}).headless,false);
 console.log('ATS browser policy PASS: one headless trial per platform/profile, failures persist, unknown hosts visible, redirects bounded, known failures seeded.');
}finally{rmSync(work,{recursive:true,force:true});}
