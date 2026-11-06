// One lifetime headless trial per ATS/platform and profile. No candidate facts live here.
import { mkdirSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readJson, writeJson, employerUrl } from './auto-apply.mjs';

export const browserLedgerPath = work => join(work, 'runtime', 'ats-browser-policy.json');
export function readBrowserLedger(work) {
  const ledger = readJson(browserLedgerPath(work), { version: 1, platforms: {}, hostPlatforms: {} });
  if (ledger.version !== 1 || !ledger.platforms || !ledger.hostPlatforms) throw Error('Invalid ATS browser ledger; manual repair required');
  return ledger;
}
function locked(work, action) {
  const path = browserLedgerPath(work) + '.lock';
  mkdirSync(dirname(path), { recursive: true });
  let fd;
  try { fd = openSync(path, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') return { busy: true }; throw error; }
  try { return action(); } finally { closeSync(fd); unlinkSync(path); }
}
export function atsPlatform(url, ledger = { hostPlatforms: {} }) {
  const host = employerUrl(url).hostname.toLowerCase();
  if (Object.hasOwn(ledger.hostPlatforms, host)) return ledger.hostPlatforms[host];
  const suffix = domain => host === domain || host.endsWith('.' + domain);
  if (suffix('greenhouse.io')) return 'greenhouse';
  if (suffix('myworkdayjobs.com') || suffix('myworkdaysite.com')) return 'workday';
  if (suffix('lever.co')) return 'lever';
  if (suffix('ashbyhq.com')) return 'ashby';
  if (suffix('eightfold.ai')) return 'eightfold';
  return null; // Unknown/custom hosts start visible, never get a per-job trial.
}
export function reserveBrowserSelection({ work, url }) {
  employerUrl(url);
  const visible = reason => ({ headless: false, platform: atsPlatform(url, readBrowserLedger(work)), reason });
  const result = locked(work, () => {
    const ledger = readBrowserLedger(work), platform = atsPlatform(url, ledger);
    if (!platform) return visible('unknown_host');
    if (Object.hasOwn(ledger.platforms, platform)) return visible('trial_already_consumed');
    const reservationId = randomUUID();
    ledger.platforms[platform] = { status: 'reserved', reservationId, reservedAt: new Date().toISOString(), host: new URL(url).hostname };
    writeJson(browserLedgerPath(work), ledger); // Persist BEFORE launch; crashes never restore budget.
    return { headless: true, platform, reservationId, reason: 'first_platform_trial' };
  });
  return result.busy ? visible('ledger_busy') : result;
}
export function finishBrowserTrial({ work, selection, error }) {
  if (!selection?.headless) return;
  const result = locked(work, () => {
    const ledger = readBrowserLedger(work), entry = ledger.platforms[selection.platform];
    if (entry?.reservationId !== selection.reservationId || entry.status !== 'reserved') return;
    Object.assign(entry, { status: error ? 'failed' : 'succeeded', finishedAt: new Date().toISOString() });
    // Failure details may include form values; callers retain those in their private evidence.
    writeJson(browserLedgerPath(work), ledger);
  });
  // If another writer owns the lock, the durable reservation still prohibits all retries.
  return result;
}
// Seed previously observed failures/host aliases separately in profile-work, not engine code.
export function seedBrowserFailures({ work, platforms, hostPlatforms = {}, evidence = 'prior_observed_failure' }) {
  if (!Array.isArray(platforms) || platforms.some(p => typeof p !== 'string' || !p.trim())) throw Error('Platform keys required');
  for (const [host, platform] of Object.entries(hostPlatforms)) {
    if (new URL('https://' + host).hostname !== host || !platforms.includes(platform)) throw Error('Invalid host/platform alias');
  }
  const result = locked(work, () => {
    const ledger = readBrowserLedger(work);
    for (const platform of platforms) ledger.platforms[platform] = { ...ledger.platforms[platform], status: 'failed', finishedAt: new Date().toISOString(), evidence };
    Object.assign(ledger.hostPlatforms, hostPlatforms);
    writeJson(browserLedgerPath(work), ledger);
    return ledger;
  });
  if (result.busy) throw Error('ATS ledger busy; seed again after writer exits');
  return result;
}
export async function launchEmployerBrowser({ work, url, browserFactory, executablePath, existingBrowser = false }) {
  const selection = existingBrowser ? {headless:false,platform:atsPlatform(url,readBrowserLedger(work)),reason:'existing_profile'} : reserveBrowserSelection({ work, url });
  try {
    const browser = await browserFactory({ executablePath, headless: selection.headless, args: ['--window-size=1440,1000'] });
    return { browser, selection };
  } catch (error) { finishBrowserTrial({ work, selection, error }); throw error; }
}
// A headless trial must not silently become another platform's unreserved trial on redirect.
export async function installBrowserPlatformGuard(context, { work, selection }) {
  if (!selection.headless) return;
  await context.route('**/*', async route => {
    const request = route.request();
    if (request.isNavigationRequest() && atsPlatform(request.url(), readBrowserLedger(work)) !== selection.platform) return route.abort('blockedbyclient');
    return route.fallback();
  });
}
