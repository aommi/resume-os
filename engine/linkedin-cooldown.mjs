// Server throttling is a timed pause; authentication stops remain a separate owner.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

function instant(now) { const value = typeof now === 'function' ? now() : now; return value instanceof Date ? value : new Date(value); }
function ledgerPath(work) { return join(work, 'runtime', 'linkedin-cooldown.json'); }
function readLedger(work) {
  const path = ledgerPath(work);
  if (!existsSync(path)) return null;
  let value;
  try { value = JSON.parse(readFileSync(path, 'utf8')); } catch { throw Object.assign(new Error('Invalid LinkedIn cooldown ledger; manual review required'), { code: 'LINKEDIN_COOLDOWN_INVALID' }); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || value.reason !== 'rate_limited' || !Number.isSafeInteger(value.count) || value.count < 1 ||
      typeof value.retryAt !== 'string' || !Number.isFinite(Date.parse(value.retryAt)) ||
      typeof value.recordedAt !== 'string' || !Number.isFinite(Date.parse(value.recordedAt))) {
    throw Object.assign(new Error('Invalid LinkedIn cooldown ledger; manual review required'), { code: 'LINKEDIN_COOLDOWN_INVALID' });
  }
  return value;
}
function serverDeadline(retryAfter, nowMs) {
  if (retryAfter === undefined || retryAfter === null || String(retryAfter).trim() === '') return null;
  const raw = String(retryAfter).trim();
  const cap = nowMs + 7 * 24 * 3600000;
  if (/^\d+$/.test(raw)) {
    const value = nowMs + Number(raw) * 1000;
    return Number.isSafeInteger(value) && Number.isFinite(new Date(value).getTime()) ? Math.min(value, cap) : null;
  }
  const value = Date.parse(raw);
  return Number.isFinite(value) && value > nowMs ? Math.min(value, cap) : null;
}
export function recordLinkedInCooldown({ work, retryAfter, now = new Date(), workflow = 'linkedin' }) {
  const date = instant(now), nowMs = date.getTime();
  if (!Number.isFinite(nowMs)) throw new Error('Invalid cooldown clock');
  const previous = readLedger(work);
  const previousRetryAt = previous ? Date.parse(previous.retryAt) : 0;
  const active = previous && previousRetryAt > nowMs;
  const stale = previous && previousRetryAt < nowMs - 48 * 3600000;
  const count = active ? previous.count : stale ? 1 : (previous?.count || 0) + 1;
  const fallback = nowMs + Math.min(24, 2 ** Math.min(count - 1, 5)) * 3600000;
  const deadline = serverDeadline(retryAfter, nowMs);
  const retryAt = Math.max(deadline ?? (active ? previousRetryAt : fallback), active ? previousRetryAt : 0);
  const ledger = { version: 1, reason: 'rate_limited', count, recordedAt: date.toISOString(), retryAt: new Date(retryAt).toISOString(), workflow };
  const path = ledgerPath(work);
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(ledger, null, 2) + '\n', { mode: 0o600 });
  renameSync(temp, path);
  return ledger;
}
export function assertLinkedInCooldown({ work, now = new Date() }) {
  const ledger = readLedger(work);
  const date = instant(now);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid cooldown clock');
  if (ledger && Date.parse(ledger.retryAt) > date.getTime()) {
    throw Object.assign(new Error(`LINKEDIN_RATE_LIMITED: cooldown until ${ledger.retryAt}`), { code: 'LINKEDIN_COOLDOWN', retryAt: ledger.retryAt });
  }
  return ledger;
}
