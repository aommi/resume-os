import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, writeFileSync } from 'node:fs';
import { resolveBrowserPath, workDir } from './config.mjs';
import { acquireLinkedInLock } from './linkedin-lock.mjs';
import { clearDeadChromeLock } from './linkedin-profile-lock.mjs';
import { assertLinkedInSession } from './linkedin-session.mjs';

// Self-contained for page.evaluate. Never associates a list of card IDs with one URL.
export function decodeLinkedInResponseEvidence(raw) {
  const doc = new DOMParser().parseFromString(raw, 'text/html');
  const decoder = document.createElement('textarea');
  decoder.innerHTML = raw;
  const texts = [raw, decoder.value, ...[...doc.querySelectorAll('script,code')].map(x => x.textContent)];
  const ids = new Set(), urls = new Set(), bindings = [];
  let visited = 0, truncated = false;
  function walk(value, depth = 0) {
    if (depth > 40 || ++visited > 20000) { truncated = true; return; }
    if (Array.isArray(value)) { for (const child of value) { if (truncated) break; walk(child, depth + 1); } return; }
    if (!value || typeof value !== 'object') return;
    const directIds = new Set();
    for (const key of ['jobId', 'jobPostingId', 'linkedinJobId', 'entity', 'entityUrn', 'jobPostingUrn']) {
      const text = String(value[key] ?? '');
      const id = text.match(/^(?:urn:li:jobPosting:)?([1-9]\d*)$/)?.[1];
      if (id) directIds.add(id);
    }
    if (directIds.size === 1) for (const key of ['applyUrl', 'companyApplyUrl', 'externalApplyUrl', 'applicationUrl']) {
      if (typeof value[key] !== 'string') continue;
      try {
        let u = new URL(value[key]);
        if (/(^|\.)linkedin\.com$/i.test(u.hostname) && u.searchParams.has('url')) u = new URL(u.searchParams.get('url'));
        if (u.protocol === 'https:' && !u.username && !u.password && !/(^|\.)(linkedin|licdn)\.com$/i.test(u.hostname))
          bindings.push({ linkedinJobId: [...directIds][0], applyUrl: u.href });
      } catch {}
    }
    for (const child of Object.values(value)) { if (truncated) break; walk(child, depth + 1); }
  }
  for (let text of texts) {
    decoder.innerHTML = text;
    text = decoder.value;
    try { walk(JSON.parse(text)); } catch { /* Only parsed same-object relationships bind identities. */ }
    text = text.replace(/\\u002[fF]/g, '/').replace(/\\\//g, '/').replace(/\\"/g, '"');
    for (const m of text.matchAll(/(?:jobPosting:|job-card-component-ref-|\/jobs\/view\/)(\d+)/g)) ids.add(m[1]);
    for (const m of text.matchAll(/"(?:jobId|jobPostingId|linkedinJobId)"\s*:\s*"?(\d+)/g)) ids.add(m[1]);
    for (const m of text.matchAll(/https?:\/\/[^\s"<>\\]+/g)) {
      try {
        const u = new URL(m[0].replace(/&amp;/g, '&'));
        const target = /(^|\.)linkedin\.com$/i.test(u.hostname) ? u.searchParams.get('url') : null;
        const v = target ? new URL(target) : u;
        if (['https:', 'http:'].includes(v.protocol) && !v.username && !v.password &&
            /jobs\.|careers\.|greenhouse|lever\.co|myworkdayjobs|ashbyhq|smartrecruiters/i.test(v.hostname) &&
            !/(^|\.)(linkedin|licdn)\.com$/i.test(v.hostname) && v.href.length < 2000) urls.add(v.href);
      } catch {}
    }
  }
  return { ids: [...ids], employerURLs: [...urls], bindings: truncated ? [] : bindings };
}

// Self-contained; exact detail identity, title and company must agree. Search cards
// and recommendation containers cannot provide the evidence for the detail pane.
export function readSelectedLinkedInDetail(entry) {
  const id = String(entry.linkedinJobId);
  const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const jobId = a => a.getAttribute('href')?.match(/\/jobs\/view\/(\d+)/)?.[1];
  for (const anchor of document.querySelectorAll('a[href*="/jobs/view/"]')) {
    if (jobId(anchor) !== id || anchor.closest('[componentkey^="job-card-component-ref-"],li[data-occludable-job-id],.job-card-container')) continue;
    for (let pane = anchor.parentElement; pane && pane !== document.body; pane = pane.parentElement) {
      if (pane.querySelector('[componentkey^="job-card-component-ref-"],li[data-occludable-job-id],.job-card-container')) break;
      const ids = new Set([...pane.querySelectorAll('a[href*="/jobs/view/"]')].map(jobId).filter(Boolean));
      if (ids.size !== 1 || !ids.has(id)) break;
      const titleMatches = [anchor, ...pane.querySelectorAll('h1,h2')].some(x => norm(x.textContent) === norm(entry.title));
      const companyMatches = [...pane.querySelectorAll('a[href*="/company/"],.job-details-jobs-unified-top-card__company-name')].some(x => norm(x.textContent) === norm(entry.company));
      if (!titleMatches || !companyMatches || !norm(entry.title) || !norm(entry.company)) continue;
      const urls = new Set();
      for (const a of pane.querySelectorAll('a[href]')) {
        if (!/^apply(?:\s|$)/i.test((a.innerText || a.getAttribute('aria-label') || '').trim())) continue;
        try {
          let u = new URL(a.href);
          if (/(^|\.)linkedin\.com$/i.test(u.hostname) && u.searchParams.has('url')) u = new URL(u.searchParams.get('url'));
          if (['https:', 'http:'].includes(u.protocol) && !u.username && !u.password && !/(^|\.)(linkedin|licdn)\.com$/i.test(u.hostname)) urls.add(u.href);
        } catch {}
      }
      const description = pane.querySelector('.jobs-description__content,.jobs-description-content__text,.show-more-less-html__markup,[data-testid="expandable-text-box"]')?.innerText?.trim();
      if (urls.size > 1) return null;
      if (urls.size || description) return { applyUrl: [...urls][0] || null, description: description || undefined, title: entry.title, company: entry.company, sourceEvidence: { linkedinJobId: id, method: 'selected-detail-dom', titleAndCompanyMatched: true } };
    }
  }
  return null;
}

export function selectLinkedInResponseURL(records, id) {
  const urls = new Set(records.flatMap(r => r.bindings || []).filter(binding => binding.linkedinJobId === String(id)).map(binding => binding.applyUrl));
  return urls.size === 1 ? [...urls][0] : null;
}

export async function resolveLinkedInDetail(entry) {
  const id = String(entry.linkedinJobId || '');
  if (!/^\d+$/.test(id) || !entry.title || !entry.company) throw new Error('LinkedIn detail requires an exact job ID, title and company');
  const stop = join(workDir(), 'linkedin-stop.json');
  if (existsSync(stop)) throw new Error('LinkedIn stop state is active; no browser opened');
  const lock = acquireLinkedInLock('linkedin-selected-detail');
  if (!lock.acquired) throw new Error('LinkedIn browser busy; no detail request made');
  let proc, browser, timedOut = false, stopped = false;
  const pending = new Set(), records = [];
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const persistStop = reason => {
    stopped = true;
    if (!existsSync(stop)) writeFileSync(stop, JSON.stringify({ reason, detectedAt: new Date().toISOString(), workflow: 'linkedin-selected-detail' }) + '\n', { mode: 0o600 });
  };
  const timer = setTimeout(() => { timedOut = true; proc?.kill('SIGTERM'); }, 75000);
  try {
    clearDeadChromeLock(join(homedir(), '.linkedin-chrome-profile/SingletonLock'));
    const server = createServer();
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    proc = spawn(resolveBrowserPath(), [`--user-data-dir=${join(homedir(), '.linkedin-chrome-profile')}`, `--remote-debugging-port=${port}`, '--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1920,1080', 'about:blank'], { stdio: 'ignore' });
    let spawnError;
    proc.on('error', error => { spawnError = error; });
    for (let i = 0; i < 30 && !timedOut; i++) {
      if (spawnError) throw spawnError;
      try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 }); break; } catch { await pause(300); }
    }
    if (!browser) throw new Error('Chrome did not become ready');
    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(5000);
    page.on('response', response => {
      if (!/(^|\.)linkedin\.com$/i.test(new URL(response.url()).hostname) || !['document', 'xhr', 'fetch'].includes(response.request().resourceType())) return;
      if (response.status() === 429) { persistStop('rate_limited'); return; }
      if (response.status() >= 400 || pending.size >= 30 || stopped || timedOut) return;
      const task = (async () => {
        let timeout;
        try {
          const body = await Promise.race([response.body(), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('response timeout')), 5000); })]);
          if (body.length > 12000000 || stopped || timedOut) return;
          records.push(await page.evaluate(decodeLinkedInResponseEvidence, body.toString()));
        } catch {} finally { clearTimeout(timeout); }
      })();
      pending.add(task); task.finally(() => pending.delete(task));
    });
    const check = async () => {
      if (stopped) throw new Error('LINKEDIN_RATE_LIMITED: automation stopped');
      if (timedOut) throw new Error('LinkedIn detail timed out');
      try { await assertLinkedInSession(page); } catch (error) {
        if (/LINKEDIN_AUTH_REQUIRED/.test(error.message)) persistStop('auth_challenge');
        throw error;
      }
    };
    const url = new URL('https://www.linkedin.com/jobs/search-results/');
    url.searchParams.set('currentJobId', id);
    url.searchParams.set('keywords', entry.title);
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await pause(2500); await check();
    let detail = await page.evaluate(readSelectedLinkedInDetail, entry);
    if (!detail) {
      const card = page.locator(`[role="button"][componentkey="job-card-component-ref-${id}"]`);
      if (await card.count() === 1) { await card.click(); await pause(2500); await check(); }
      detail = await page.evaluate(readSelectedLinkedInDetail, entry);
    }
    await Promise.allSettled([...pending]);
    await check();
    const applyUrl = selectLinkedInResponseURL(records, id);
    if (detail?.applyUrl && applyUrl && detail.applyUrl !== applyUrl) throw new Error('Ambiguous LinkedIn apply URL evidence');
    if (detail?.applyUrl || (detail?.description && !applyUrl)) return detail;
    if (applyUrl) return { applyUrl, ...(detail?.description ? { description: detail.description } : {}), title: entry.title, company: entry.company, sourceEvidence: { linkedinJobId: id, method: 'response-explicit-binding' } };
    throw new Error('No unambiguous selected LinkedIn detail evidence');
  } finally {
    clearTimeout(timer);
    try { await browser?.close(); } catch {}
    if (proc && proc.exitCode === null) {
      proc.kill('SIGTERM');
      await Promise.race([new Promise(resolve => proc.once('exit', resolve)), pause(2000)]);
      if (proc.exitCode === null) proc.kill('SIGKILL');
    }
    lock.release();
  }
}
