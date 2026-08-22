#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const profileId = `gmail-runtime-test-${process.pid}`;
const profileDir = join(process.cwd(), "profiles", profileId);
const work = join(profileDir, "work");
const binDir = join(profileDir, "bin");
const bodyDir = join(profileDir, "bodies");
const pendingDir = join(work, "events/pending");
const snapshotDir = join(work, "runtime/gmail-sync");
const himalayaCalls = join(profileDir, "himalaya-calls.log");
const hermesCalls = join(profileDir, "hermes-calls.log");
const syncLog = join(profileDir, "gmail-sync.log");
const briefLog = join(profileDir, "daily-brief.log");
const baseEnv = {
  ...process.env,
  RESUME_OS_PROFILE: profileId,
  PATH: `${binDir}:${process.env.PATH}`,
  HIMALAYA_BODY_DIR: bodyDir,
  HIMALAYA_CALLS: himalayaCalls,
  HERMES_CALLS: hermesCalls,
};

const envelopes = [
  {
    id: "101",
    subject: "Application received",
    from: { name: "Example Careers", addr: "jobs@example.com" },
    to: { name: "Candidate", addr: "candidate@example.com" },
    date: "2026-08-20T10:00:00Z",
  },
  {
    id: "102",
    subject: "Team meeting tomorrow",
    from: { name: "A Friend", addr: "friend@example.com" },
    to: { name: "Candidate", addr: "candidate@example.com" },
    date: "2026-08-20T09:00:00Z",
  },
  {
    id: "103",
    subject: "Complete your assessment",
    from: { name: "Recruiting Team", addr: "talent@example.com" },
    to: { name: "Candidate", addr: "candidate@example.com" },
    date: "2026-08-20T08:00:00Z",
  },
  {
    id: "104",
    subject: "Thank you for dinner",
    from: { name: "A Friend", addr: "friend@example.com" },
    to: { name: "Candidate", addr: "candidate@example.com" },
    date: "2026-08-20T07:00:00Z",
  },
];

try {
  mkdirSync(binDir, { recursive: true });
  mkdirSync(bodyDir, { recursive: true });
  mkdirSync(pendingDir, { recursive: true });
  writeFileSync(join(profileDir, "profile.json"), `${JSON.stringify({ profileId })}\n`);
  writeFileSync(join(bodyDir, "101.txt"), "We received your application. Visit https://example.com/private-link for details.\n");
  writeFileSync(join(bodyDir, "102.txt"), "Bring the dinner notes.\n");
  writeFileSync(join(bodyDir, "103.txt"), "Your verification code is 123456. Do not share it.\n");
  writeFileSync(join(bodyDir, "104.txt"), "Dinner was fun.\n");
  writeExecutable("himalaya", `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$HIMALAYA_CALLS"
if [ "$1" = "envelope" ]; then
  if [ "\${HIMALAYA_FAIL_LIST:-0}" = "1" ]; then
    exit 23
  fi
  printf '%s\n' "$HIMALAYA_ENVELOPES"
  exit 0
fi
if [ "$1" = "message" ]; then
  message_id="\${!#}"
  printf '%s' "$(<"$HIMALAYA_BODY_DIR/$message_id.txt")"
  exit 0
fi
exit 24
`);
  writeExecutable("hermes", `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = "chat" ]; then
  if [ "\${HERMES_TASK:-brief}" = "gmail" ]; then
    printf 'chat:gmail\n' >> "$HERMES_CALLS"
    case "\${HERMES_GMAIL_BEHAVIOR:-success}" in
      success)
        mkdir -p "$HERMES_PENDING_DIR"
        printf '## NO_JOB_EMAIL_EVENTS\n- notes: No relevant job-application emails found.\n' > "$HERMES_PENDING_DIR/gmail-runtime-$$.md"
        printf 'monitor complete\n'
        exit 0
        ;;
      fail) exit 17 ;;
      *) exit 18 ;;
    esac
  fi
  case " $* " in
    *" --provider deepseek "*) runner="deepseek"; behavior="\${HERMES_DEEPSEEK_BEHAVIOR:-success}" ;;
    *) runner="openai"; behavior="\${HERMES_OPENAI_BEHAVIOR:-success}" ;;
  esac
  printf 'chat:%s\n' "$runner" >> "$HERMES_CALLS"
  case "$behavior" in
    success) printf 'Action brief from %s\n' "$runner" ;;
    blank) : ;;
    fail) exit 19 ;;
    *) exit 20 ;;
  esac
  exit 0
fi
if [ "$1" = "send" ]; then
  printf 'send\n' >> "$HERMES_CALLS"
  cat >/dev/null
  exit 0
fi
exit 21
`);

  testSnapshotFilteringAndCredentialOmission();
  testGmailWrapperCleanupAndFailures();
  testDailyBriefFallback();
} finally {
  rmSync(profileDir, { recursive: true, force: true });
}

console.log("gmail runtime tests: PASS");

function writeExecutable(name, content) {
  const path = join(binDir, name);
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function run(command, args, envOverrides = {}) {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    env: {
      ...baseEnv,
      HIMALAYA_ENVELOPES: JSON.stringify(envelopes),
      ...envOverrides,
    },
    encoding: "utf8",
  });
}

function testSnapshotFilteringAndCredentialOmission() {
  rmSync(himalayaCalls, { force: true });
  const output = join(profileDir, "snapshot.json");
  const result = run(process.execPath, [
    "scripts/fetch-gmail-events.mjs",
    "--output", output,
    "--after", "2026-08-17",
  ]);
  assert.equal(result.status, 0, result.stderr);
  const snapshot = JSON.parse(readFileSync(output, "utf8"));
  assert.equal(snapshot.message_count, 2);
  assert.deepEqual(snapshot.messages.map((message) => message.imap_id), ["101", "103"]);
  assert.equal(snapshot.messages[0].body.includes("https://"), false);
  assert.match(snapshot.messages[0].body, /\[redacted link\]/);
  assert.equal(snapshot.messages[1].body, "[credential-bearing message omitted]");
  assert.equal(JSON.stringify(snapshot).includes("123456"), false);
  assert.equal(statSync(output).mode & 0o777, 0o600);
  const calls = readFileSync(himalayaCalls, "utf8");
  assert.match(calls, /message read --preview --no-headers 101/);
  assert.match(calls, /message read --preview --no-headers 103/);
  assert.doesNotMatch(calls, /--no-headers 102/);
  assert.doesNotMatch(calls, /--no-headers 104/);
}

function testGmailWrapperCleanupAndFailures() {
  mkdirSync(snapshotDir, { recursive: true });
  const staleSnapshot = join(snapshotDir, "20260101-000000.json");
  const keepFile = join(snapshotDir, "keep.txt");
  writeFileSync(staleSnapshot, "private snapshot\n");
  writeFileSync(keepFile, "not a snapshot\n");
  const old = new Date(Date.now() - 120_000);
  utimesSync(staleSnapshot, old, old);
  const common = {
    HERMES_TASK: "gmail",
    HERMES_PENDING_DIR: pendingDir,
    RESUME_OS_SYNC_LOG: syncLog,
    GMAIL_SNAPSHOT_MAX_AGE_MINUTES: "1",
  };

  rmSync(hermesCalls, { force: true });
  const success = run("bash", ["scripts/run-gmail-sync.sh"], {
    ...common,
    HERMES_GMAIL_BEHAVIOR: "success",
  });
  assert.equal(success.status, 0, success.stderr);
  assert.equal(existsSync(staleSnapshot), false);
  assert.equal(existsSync(keepFile), true);
  assert.deepEqual(readdirSync(snapshotDir).filter((name) => name.endsWith(".json")), []);
  let heartbeat = JSON.parse(readFileSync(join(work, "heartbeats/gmail-sync.json"), "utf8"));
  assert.equal(heartbeat.exitCode, 0);
  assert.equal(existsSync(join(work, "runtime", "interview-postmortem-scan.json")), true);

  const monitorFailure = run("bash", ["scripts/run-gmail-sync.sh"], {
    ...common,
    HERMES_GMAIL_BEHAVIOR: "fail",
  });
  assert.equal(monitorFailure.status, 17, monitorFailure.stderr);
  assert.deepEqual(readdirSync(snapshotDir).filter((name) => name.endsWith(".json")), []);
  heartbeat = JSON.parse(readFileSync(join(work, "heartbeats/gmail-sync.json"), "utf8"));
  assert.equal(heartbeat.failureCategory, "monitor_failed");

  const mailboxFailure = run("bash", ["scripts/run-gmail-sync.sh"], {
    ...common,
    HIMALAYA_FAIL_LIST: "1",
    HERMES_GMAIL_BEHAVIOR: "success",
  });
  assert.equal(mailboxFailure.status, 1, mailboxFailure.stderr);
  assert.deepEqual(readdirSync(snapshotDir).filter((name) => name.endsWith(".json")), []);
  heartbeat = JSON.parse(readFileSync(join(work, "heartbeats/gmail-sync.json"), "utf8"));
  assert.equal(heartbeat.failureCategory, "mailbox_read_failed");
}

function testDailyBriefFallback() {
  writeFileSync(join(work, "jobs-tracker.md"), `# Job Tracker

## Upcoming Events

None.

## To Review

None.

## To Apply

None.

## Package Ready

None.

## Applied

None.

## Needs Action

None.

## Interviewing

| ID | Company | Role |
|---:|---|---|
| 1 | Example Co | Product Manager |

## Skipped

None.

## Closed

None.
`);

  let result = runBrief("success", "fail");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, ["chat:openai", "send"]);
  assert.equal(result.heartbeat.model, "gpt-5.6-terra");

  result = runBrief("fail", "success");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, ["chat:openai", "chat:deepseek", "send"]);
  assert.equal(result.heartbeat.model, "deepseek-v4-pro");

  result = runBrief("blank", "success");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, ["chat:openai", "chat:deepseek", "send"]);

  result = runBrief("fail", "fail");
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(result.calls, ["chat:openai", "chat:deepseek"]);
  assert.equal(result.heartbeat.failureCategory, "agent_failed");

  result = runBrief("blank", "blank");
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(result.calls, ["chat:openai", "chat:deepseek"]);
  assert.equal(result.heartbeat.failureCategory, "brief_output_missing");

  result = runBrief("blank", "fail");
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(result.calls, ["chat:openai", "chat:deepseek"]);
  assert.equal(result.heartbeat.failureCategory, "agent_failed");
}

function runBrief(openaiBehavior, deepseekBehavior) {
  rmSync(hermesCalls, { force: true });
  const result = run("bash", ["scripts/run-daily-brief.sh"], {
    HERMES_TASK: "brief",
    HERMES_OPENAI_BEHAVIOR: openaiBehavior,
    HERMES_DEEPSEEK_BEHAVIOR: deepseekBehavior,
    BRIEF_SEND_TARGET: "telegram:test",
    RESUME_OS_BRIEF_LOG: briefLog,
  });
  const calls = existsSync(hermesCalls)
    ? readFileSync(hermesCalls, "utf8").trim().split("\n").filter(Boolean)
    : [];
  const heartbeat = JSON.parse(readFileSync(join(work, "heartbeats/daily-brief.json"), "utf8"));
  return { ...result, calls, heartbeat };
}
