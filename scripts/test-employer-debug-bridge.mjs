#!/usr/bin/env node
// Synthetic-only regression for the shared employer application debug bridge.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { resolveBrowserPath } from '../engine/config.mjs';
import { employerDebugCommand } from '../engine/employer-debug-bridge.mjs';
import {verifyFilledPlan} from './submit-employer-application.mjs';

process.env.RESUME_OS_PROFILE = 'example';
const root = mkdtempSync(join(tmpdir(), 'employer-debug-bridge-'));
const work = join(root, 'work');
const pkg = join(work, 'applications', 'Fixture');
mkdirSync(pkg, { recursive: true });
const resume = join(pkg, 'Resume.pdf');
writeFileSync(resume, '%PDF-1.4 synthetic fixture');
const manifest = {
  profileId: 'example',
  jobId: 'fixture-1',
  url: 'https://employer.example.test/jobs/fixture-1',
  applicationPackage: 'applications/Fixture',
  fields: [
    { label: 'First name', selectors: ['#first-name'], valueFrom: 'profile.firstName' },
    { label: 'Work authorization', selectors: ['#authorization'], type: 'combobox', valueFrom: 'ats.legallyAbleToWork' },
  ],
  fileUploads: [{ label: 'Resume', selectors: ['#resume'], path: 'Resume.pdf' }],
  submit: { selector: '#manifest-submit:has-text("Review")' },
};
const manifestPath = join(pkg, 'application.json');
writeFileSync(manifestPath, JSON.stringify(manifest));
writeFileSync(join(root,'application-policy.json'),JSON.stringify({version:1,profileId:'example',enabled:true,autoSubmit:true,jobIds:['fixture-1'],requiredTerms:'allow',accounts:'allow'}));

let browser;
try {
  browser = await chromium.launch({ executablePath: resolveBrowserPath(), headless: true });
  const page = await browser.newPage();
  // setContent keeps this fixture local. No external URL is loaded or contacted.
  await page.setContent(`<!doctype html><html><head><title>Fixture</title></head><body>
    <p>Security verification code: 123456</p>
    <label>Security code <input id="otp" name="security_code" value="876543"></label>
    <input id="password" name="password" type="password" value="fixture-secret">
    <input id="email" name="email" type="email" value="fixture@example.test">
    <label>First name <input id="first-name"></label>
    <label>Work authorization <input id="authorization" role="combobox" aria-controls="auth-options"></label>
    <div id="auth-options"><div role="option">Yes</div><div role="option">No</div></div>
    <div id="decoy-options"><div role="option">Yes</div><div role="option">No</div></div>
    <div id="selection-result"></div>
    <input id="resume" type="file">
    <button id="neutral-submit" type="submit">Continue</button>
    <button id="apply-now" type="button">Apply now</button>
    <button id="ordinary" type="button">Add another location</button>
    <button id="manifest-submit" type="button"><span>Review</span></button>
    <button id="privacy" type="submit">I Agree</button>
    <div id="ordinary-result"></div>
    <script>
      document.querySelector('#auth-options [role=option]:first-child').addEventListener('click', () => {
        document.querySelector('#authorization').value = 'Yes';
        document.querySelector('#selection-result').textContent = 'scoped yes';
      });
      document.querySelector('#decoy-options [role=option]:first-child').addEventListener('click', () => {
        document.querySelector('#selection-result').textContent = 'wrong global option';
      });
      document.querySelector('#ordinary').addEventListener('click', () => {
        document.querySelector('#ordinary-result').textContent = 'clicked';
      });
    </script>
  </body></html>`);

  const context = { work, manifestPath };
  const inspected = await employerDebugCommand(page, { action: 'inspect' }, context);
  assert.match(inspected.text, /Security verification code: \[redacted\]/);
  assert.doesNotMatch(inspected.text, /123456|876543/);
  assert.equal(inspected.controls.find(control => control.id === 'otp').value, '[redacted]');
  assert.equal(inspected.controls.find(control => control.id === 'password').value, '[redacted]');
  assert.equal(inspected.controls.find(control => control.id === 'email').value, 'fixture@example.test');

  assert.deepEqual(await employerDebugCommand(page, { action: 'fill', label: 'First name' }, context), { status: 'performed', label: 'First name' });
  assert.equal(await page.locator('#first-name').inputValue(), 'Jordan');

  assert.deepEqual(await employerDebugCommand(page, { action: 'select', label: 'Work authorization' }, context), { status: 'performed', label: 'Work authorization' });
  assert.equal(await page.locator('#selection-result').innerText(), 'scoped yes', 'the combobox must select its controlled option, not the global decoy');
  assert.equal(await page.locator('#authorization').inputValue(), 'Yes');

  assert.deepEqual(await employerDebugCommand(page, { action: 'upload', label: 'Resume' }, context), { status: 'performed', label: 'Resume' });
  assert.equal(await page.locator('#resume').evaluate(el => el.files[0]?.name), 'Resume.pdf');
  const traversalManifest = { ...manifest, fileUploads: [{ label: 'Resume', selectors: ['#resume'], path: '../outside.pdf' }] };
  const traversalPath = join(pkg, 'traversal.json');
  writeFileSync(traversalPath, JSON.stringify(traversalManifest));
  await assert.rejects(
    employerDebugCommand(page, { action: 'upload', label: 'Resume' }, { ...context, manifestPath: traversalPath }),
    /parent traversal/,
  );
  await assert.rejects(employerDebugCommand(page, { action: 'upload', label: 'Unreviewed file' }, context), /reviewed manifest file/);

  await assert.rejects(employerDebugCommand(page, { action: 'click', selector: '#neutral-submit' }, context), /final application submission/);
  await assert.rejects(employerDebugCommand(page, { action: 'click', selector: '#apply-now' }, context), /final application submission/);
  await assert.rejects(employerDebugCommand(page, { action: 'click', selector: '#manifest-submit span' }, context), /final application submission/);
  await assert.rejects(employerDebugCommand(page, { action: 'select', label:'Work authorization',selector:'#manifest-submit' }, context), /combobox input/);
  await employerDebugCommand(page,{action:'click',selector:'#privacy'},context);
  assert.deepEqual(await employerDebugCommand(page, { action: 'click', selector: '#ordinary' }, context), { status: 'performed', text: 'Add another location' });
  assert.equal(await page.locator('#ordinary-result').innerText(), 'clicked');
  await page.locator('#resume').evaluate(el=>el.value='');
  await page.evaluate(()=>{const card=document.createElement('div');card.innerHTML='<span>Resume.pdf</span><span>File upload completed successfully</span>';document.body.append(card);});
  const uploadedPlan={url:manifest.url,fields:[],fileUploads:[{label:'Resume',selectors:['#resume'],path:resume}]};
  const confirmations=[{label:'Resume',confirmation:{url:'https://employer.example.test/resume_upload',message:'File upload completed successfully'}}];
  await assert.rejects(verifyFilledPlan(page,uploadedPlan,{confirmations}),/not present/);
  await assert.rejects(verifyFilledPlan(page,uploadedPlan,{confirmations,network:[{method:'POST',url:'https://employer.example.test/resume_upload',status:500}]}),/not present/);
  await verifyFilledPlan(page,uploadedPlan,{confirmations,network:[{method:'POST',url:'https://employer.example.test/resume_upload',status:200}]});
  console.log('Employer debug bridge fixture PASS: secret redaction, reviewed fill, controlled combobox scope, package-contained upload, and final-submit refusal. No network requests or employer contacted.');
} finally {
  await browser?.close();
  rmSync(root, { recursive: true, force: true });
}
