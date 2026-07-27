import assert from "node:assert/strict";
import { alertFingerprint, shouldSendAlert, ALERT_REPEAT_MS } from "../engine/watchdog-alerts.mjs";

const DISCOVERY_15 = "Discovery agent DOWN: last success 1.5 days ago (cadence 6h)";
const DISCOVERY_18 = "Discovery agent DOWN: last success 1.8 days ago (cadence 6h)";
const BRIEF = "daily-brief: last success 2026-07-16T02:47:39Z (cadence 1440m)";
const GMAIL = "Gmail monitor stale: last run 2026-07-24 (3d ago)";

// The bug this guards: messages embed a growing age, so hashing the rendered
// text produced a new hash every run and re-alerted for one unchanged fault.
assert.equal(
  alertFingerprint([DISCOVERY_15, BRIEF]),
  alertFingerprint([DISCOVERY_18, BRIEF]),
  "an advancing age must not change the problem-set identity",
);

// Order must not matter — the set is what identifies the fault, not its ordering.
assert.equal(alertFingerprint([DISCOVERY_15, BRIEF]), alertFingerprint([BRIEF, DISCOVERY_15]));

// A genuinely different problem set must still alert.
assert.notEqual(alertFingerprint([DISCOVERY_15, BRIEF]), alertFingerprint([DISCOVERY_15]));
assert.notEqual(alertFingerprint([DISCOVERY_15]), alertFingerprint([GMAIL]));

// --- shouldSendAlert ---

const now = Date.parse("2026-07-27T12:00:00Z");
const sentAt = (iso, problems) => ({ hash: alertFingerprint(problems), lastSent: iso });

// Nothing wrong: never send.
assert.equal(shouldSendAlert([], null, now), false);

// First occurrence always sends.
assert.equal(shouldSendAlert([DISCOVERY_15], null, now), true);

// Same fault, age advanced, within 24h: suppressed.
assert.equal(
  shouldSendAlert([DISCOVERY_18], sentAt("2026-07-27T06:00:00Z", [DISCOVERY_15]), now),
  false,
);

// Same fault, but 24h has elapsed: re-alert.
assert.equal(
  shouldSendAlert(
    [DISCOVERY_18],
    { hash: alertFingerprint([DISCOVERY_15]), lastSent: new Date(now - ALERT_REPEAT_MS - 1).toISOString() },
    now,
  ),
  true,
);

// A new fault appearing alongside an old one sends immediately.
assert.equal(
  shouldSendAlert([DISCOVERY_18, BRIEF], sentAt("2026-07-27T11:00:00Z", [DISCOVERY_15]), now),
  true,
);

// A fault clearing changes the set, so the next alert reflects reality.
assert.equal(
  shouldSendAlert([DISCOVERY_18], sentAt("2026-07-27T11:00:00Z", [DISCOVERY_15, BRIEF]), now),
  true,
);

// Corrupt or missing state must not suppress an alert.
assert.equal(shouldSendAlert([DISCOVERY_15], { hash: undefined, lastSent: undefined }, now), true);

console.log("watchdog alert tests: PASS");
