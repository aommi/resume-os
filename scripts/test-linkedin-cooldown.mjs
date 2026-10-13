import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordLinkedInCooldown, assertLinkedInCooldown } from '../engine/linkedin-cooldown.mjs';
const root = mkdtempSync(join(tmpdir(), 'linkedin-cooldown-'));
const now = new Date('2026-10-13T12:00:00Z');
try {
  const work = join(root, 'fallback');
  assert.equal(assertLinkedInCooldown({ work, now }), null);
  const one = recordLinkedInCooldown({ work, now });
  assert.equal(one.retryAt, '2026-10-13T13:00:00.000Z');
  assert.throws(() => assertLinkedInCooldown({ work, now }), { code: 'LINKEDIN_COOLDOWN' });
  assert.equal(assertLinkedInCooldown({ work, now: new Date(one.retryAt) }).count, 1);
  const two = recordLinkedInCooldown({ work, now: new Date(one.retryAt) });
  assert.equal(two.retryAt, '2026-10-13T15:00:00.000Z');
  assert.equal(recordLinkedInCooldown({ work, now }).count, 2);
  let current = two;
  for (let i = 0; i < 10; i++) {
    const at = new Date(current.retryAt);
    current = recordLinkedInCooldown({ work, now: at });
    assert.ok(Date.parse(current.retryAt) - at.getTime() <= 86400000);
  }
  assert.equal(current.count, 12);
  const server = join(root, 'server');
  assert.equal(recordLinkedInCooldown({ work: server, now, retryAfter: '172800' }).retryAt, '2026-10-15T12:00:00.000Z');
  assert.equal(recordLinkedInCooldown({ work: server, now, retryAfter: '30' }).retryAt, '2026-10-15T12:00:00.000Z');
  assert.equal(recordLinkedInCooldown({ work: join(root, 'date'), now, retryAfter: 'Fri, 16 Oct 2026 12:00:00 GMT' }).retryAt, '2026-10-16T12:00:00.000Z');
  assert.equal(recordLinkedInCooldown({ work: join(root, 'huge'), now, retryAfter: '999999999' }).retryAt, '2026-10-20T12:00:00.000Z');
  assert.equal(recordLinkedInCooldown({ work: join(root, 'badheader'), now, retryAfter: 'garbage' }).retryAt, '2026-10-13T13:00:00.000Z');
  const reset = join(root, 'reset');
  const initial = recordLinkedInCooldown({ work: reset, now });
  assert.equal(initial.count, 1);
  const afterQuietPeriod = recordLinkedInCooldown({ work: reset, now: new Date(Date.parse(initial.retryAt) + 49 * 3600000) });
  assert.equal(afterQuietPeriod.count, 1);
  assert.equal(afterQuietPeriod.retryAt, '2026-10-15T15:00:00.000Z');
  const malformed = join(root, 'malformed'); mkdirSync(join(malformed, 'runtime'), { recursive: true });
  writeFileSync(join(malformed, 'runtime/linkedin-cooldown.json'), '{bad');
  assert.throws(() => assertLinkedInCooldown({ work: malformed, now }), { code: 'LINKEDIN_COOLDOWN_INVALID' });
  assert.throws(() => recordLinkedInCooldown({ work: malformed, now }), { code: 'LINKEDIN_COOLDOWN_INVALID' });
  console.log('LinkedIn cooldown: headers, expiry, exponential bounded fallback, preserved deadlines, and corrupt state PASS');
} finally { rmSync(root, { recursive: true, force: true }); }
