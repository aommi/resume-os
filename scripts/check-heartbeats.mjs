#!/usr/bin/env node
// Zero-LLM pipeline watchdog (HLT-3). No model calls, no network — by rule.
// Reads heartbeat files, compares against expected cadence, fires a local
// macOS notification on staleness. Run via LaunchAgent ai.resumeos.watchdog.
//
// Usage: node scripts/check-heartbeats.mjs [--quiet]
//   --quiet  print problems but do not send a notification (for testing)

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { workDir } from "../engine/config.mjs";

const WORK = workDir();
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DAY_MS = 24 * 60 * 60 * 1000;
const quiet = process.argv.includes("--quiet");
const problems = [];

// 1. Discovery heartbeat: .linkedin-last-checked (epoch ms), cadence every 6h.
const discoveryHb = join(REPO_ROOT, ".linkedin-last-checked");
if (!existsSync(discoveryHb)) {
  problems.push("Discovery: no heartbeat file (.linkedin-last-checked)");
} else {
  const epoch = Number(readFileSync(discoveryHb, "utf8").trim());
  const ageDays = (Date.now() - epoch) / DAY_MS;
  if (!Number.isFinite(epoch) || epoch <= 0) {
    problems.push("Discovery: heartbeat file unreadable");
  } else if (ageDays > 1) {
    problems.push(`Discovery agent DOWN: last success ${ageDays.toFixed(1)} days ago (cadence 6h)`);
  }
}

// 2. Gmail monitor: newest event file (pending or archive), cadence daily-ish.
const eventDirs = [join(WORK, "events/pending"), join(WORK, "events/archive")];
const newestEvent = eventDirs
  .flatMap((dir) => (existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".md")) : []))
  .sort()
  .at(-1);
if (!newestEvent) {
  problems.push("Gmail monitor: no event files found (never ran?)");
} else {
  const ageDays = (Date.now() - new Date(newestEvent.slice(0, 10)).getTime()) / DAY_MS;
  if (ageDays > 3) problems.push(`Gmail monitor stale: last run ${newestEvent.slice(0, 10)} (${Math.floor(ageDays)}d ago)`);
}

// 3. Unimported events sitting in pending/ for more than a day.
const pendingDir = join(WORK, "events/pending");
if (existsSync(pendingDir)) {
  const stale = readdirSync(pendingDir)
    .filter((n) => n.endsWith(".md") && !n.startsWith("."))
    .filter((n) => Date.now() - statSync(join(pendingDir, n)).mtimeMs > DAY_MS);
  if (stale.length) problems.push(`${stale.length} event file(s) unimported >24h — run import-events.mjs`);
}

// 4. Contract heartbeats (work/heartbeats/*.json): { cadenceMinutes, lastSuccess, ... }.
const hbDir = join(WORK, "heartbeats");
const requiredHeartbeats = new Map([
  ["linkedin-assessment.json", "LinkedIn assessment: no heartbeat file (cadence 5m)"],
]);
for (const [name, message] of requiredHeartbeats) {
  if (!existsSync(join(hbDir, name))) problems.push(message);
}
if (existsSync(hbDir)) {
  for (const name of readdirSync(hbDir).filter((n) => n.endsWith(".json"))) {
    try {
      const hb = JSON.parse(readFileSync(join(hbDir, name), "utf8"));
      const workflow = name.replace(".json", "");
      // A failed latest attempt is a problem NOW, not after 2x cadence.
      if ((hb.exitCode ?? 0) !== 0) {
        problems.push(`${workflow}: last run FAILED (exit ${hb.exitCode}${hb.failureCategory ? `, ${hb.failureCategory}` : ""}) at ${hb.lastAttempt ?? "unknown"}`);
      }
      const cadenceMs = (hb.cadenceMinutes ?? 1440) * 60 * 1000;
      const last = new Date(hb.lastSuccess ?? 0).getTime();
      if (Date.now() - last > 2 * cadenceMs) {
        problems.push(`${workflow}: last success ${hb.lastSuccess ?? "never"} (cadence ${hb.cadenceMinutes}m)`);
      }
    } catch {
      problems.push(`${name}: heartbeat file unreadable`);
    }
  }
}

if (problems.length === 0) {
  console.log("watchdog: all heartbeats healthy");
  process.exit(0);
}
for (const p of problems) console.log(`watchdog: PROBLEM — ${p}`);
if (!quiet) {
  const text = problems.join("; ").replace(/["\\]/g, "");
  spawnSync("osascript", [
    "-e",
    `display notification "${text.slice(0, 230)}" with title "Resume OS pipeline" subtitle "${problems.length} problem(s)" sound name "Basso"`,
  ]);
}
process.exit(1);
