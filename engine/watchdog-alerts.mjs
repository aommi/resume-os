import { createHash } from "node:crypto";

// How long an unchanged problem set stays suppressed before re-alerting.
export const ALERT_REPEAT_MS = 24 * 60 * 60 * 1000;

/**
 * Stable identity of a problem set, for alert de-duplication.
 *
 * Hashes what the problems ARE, not how they currently read. Watchdog messages
 * embed a growing age ("1.5 days ago", later "1.8 days ago") and timestamps, so
 * hashing the rendered text produced a new hash on every run and re-alerted for
 * a single unchanged fault. Digits are collapsed and the set is order-independent.
 */
export function alertFingerprint(problems = []) {
  const normalized = problems
    .map((problem) => String(problem).replace(/\d[\d.:TZ_-]*/g, "#"))
    .sort()
    .join("\n");
  return createHash("sha256").update(normalized).digest("hex");
}

/** True when an alert for this problem set should be sent now. */
export function shouldSendAlert(problems, previousState, now = Date.now()) {
  if (!problems.length) return false;
  if (!previousState) return true;
  if (previousState.hash !== alertFingerprint(problems)) return true;
  return now - Date.parse(previousState.lastSent ?? 0) >= ALERT_REPEAT_MS;
}
