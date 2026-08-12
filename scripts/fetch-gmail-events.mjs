#!/usr/bin/env node
// Read a bounded, job-relevant IMAP snapshot for the Gmail event monitor.
// This is deliberately deterministic: it does not classify job state or edit
// mail. The monitor model receives only the shortlisted message content.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const output = valueAfter("--output");
const after = valueAfter("--after");
const maxMessages = Number(valueAfter("--max-messages") || 20);

if (!output || !after || !/^\d{4}-\d{2}-\d{2}$/.test(after)) {
  throw new Error("Usage: node scripts/fetch-gmail-events.mjs --output <path> --after YYYY-MM-DD [--max-messages 20]");
}
if (!Number.isInteger(maxMessages) || maxMessages < 1 || maxMessages > 50) {
  throw new Error("--max-messages must be an integer from 1 to 50");
}

const envelopes = JSON.parse(runHimalaya([
  "envelope",
  "list",
  "--output",
  "json",
  "--page-size",
  "100",
  `after ${after} order by date desc`,
]));

const messages = envelopes
  .filter(isJobRelevant)
  .slice(0, maxMessages)
  .map((envelope) => ({
    imap_id: String(envelope.id),
    source_message_id: `imap:${envelope.id}`,
    subject: envelope.subject || "",
    from: envelope.from || {},
    to: envelope.to || {},
    date: envelope.date || "",
    body: redactSensitiveContent(runHimalaya([
      "message",
      "read",
      "--preview",
      "--no-headers",
      String(envelope.id),
    ])).slice(0, 12_000),
  }));

const snapshot = {
  generated_at: new Date().toISOString(),
  searched_after: after,
  message_count: messages.length,
  messages,
};

const outputPath = resolve(output);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? "" : args[index + 1] || "";
}

function runHimalaya(command) {
  return execFileSync("himalaya", command, {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: 60_000,
  });
}

function isJobRelevant(envelope) {
  const haystack = [
    envelope.subject,
    envelope.from?.name,
    envelope.from?.addr,
  ].filter(Boolean).join(" ");
  return /application|applied|interview|recruit|talent|hiring|candidate|screening|assessment|position|opportunity|job|career|offer|next step|schedule|meeting|invitation|thank you/i.test(haystack);
}

function redactSensitiveContent(text) {
  return text
    .replace(/\b(?:password|passcode|verification code|security code|one-time code|otp)\b\s*[:#-]?\s*\S+/gi, "[redacted credential]")
    .replace(/https?:\/\/\S+/gi, "[redacted link]");
}
