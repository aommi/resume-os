import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { resolveBrowserPath } from '../engine/config.mjs';
import { readLinkedInSearchCards } from '../engine/linkedin-search-cards.mjs';
import { assertLinkedInSession } from '../engine/linkedin-session.mjs';

const browser = await chromium.launch({ executablePath: resolveBrowserPath(), headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(`<div role="button" componentkey="job-card-component-ref-123">
    <p><span>Selected, Product Manager (Verified job)</span><span aria-hidden="true">Product Manager</span></p>
    <p>Example Company</p><p>Vancouver, BC</p><p>Posted 2 hours ago</p>
    <button aria-label="Dismiss Product Manager job"></button></div>
    <a href="/jobs/view/999/">Unrelated detail pane recommendation</a>`);
  const jobs = await page.evaluate(readLinkedInSearchCards);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].linkedinJobId, '123');
  assert.equal(jobs[0].title, 'Product Manager');
  assert.equal(jobs[0].company, 'Example Company');
  assert.equal(jobs[0].postedTimeAgo, '2 hours ago');
  await assertLinkedInSession(page);
  await page.setContent('<li data-occludable-job-id="234"><a href="/jobs/view/234/"><strong>Product Owner</strong></a><div class="artdeco-entity-lockup__subtitle">Legacy Co</div><div class="artdeco-entity-lockup__caption">Canada</div>3 hours ago</li><a href="/jobs/view/999/">Unrelated</a>');
  assert.deepEqual((await page.evaluate(readLinkedInSearchCards)).map(j => j.linkedinJobId), ['234']);
  await page.setContent('<title>Security verification</title>');
  await assert.rejects(assertLinkedInSession(page), /LINKEDIN_AUTH_REQUIRED/);
  await page.setContent('<title>LinkedIn</title><input name="session_password">');
  await assert.rejects(assertLinkedInSession(page), /LINKEDIN_AUTH_REQUIRED/);
  console.log('linkedin search cards/session tests: PASS');
} finally { await browser.close(); }
