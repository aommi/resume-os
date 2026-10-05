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
  .map((envelope) => {
    const rawBody = runHimalaya([
      "message",
      "read",
      "--preview",
      "--no-headers",
      String(envelope.id),
    ]);
    const body = isCredentialBearingMessage(envelope.subject || "", rawBody)
      ? "[credential-bearing message omitted]"
      : redactSensitiveContent(rawBody).slice(0, 12_000);
    return {
      imap_id: String(envelope.id),
      source_message_id: `imap:${envelope.id}`,
      subject: envelope.subject || "",
      from: envelope.from || {},
      to: envelope.to || {},
      date: envelope.date || "",
      body,
    };
  });

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
  const subject = String(envelope.subject || "");
  const sender = [
    envelope.from?.name,
    envelope.from?.addr,
  ].filter(Boolean).join(" ");
  const specificSubject = /\b(?:application|applied|applying|interview|recruiter|hiring|candidate|screening|assessment|offer|next steps?)\b/i;
  const recruitingSender = /\b(?:recruit|talent|hiring|careers?|jobs?)\b|greenhouse|lever|workday|ashby|jobvite|smartrecruiters/i;
  const contextualSubject = /\b(?:position|opportunity|job|career|schedule|meeting|invitation|thank you|chat|availability)\b/i;
  return specificSubject.test(subject) || (recruitingSender.test(sender) && contextualSubject.test(subject));
}

function isCredentialBearingMessage(subject, body) {
  const text = `${subject}\n${body}`;
  return /\b(?:verification|security|one[- ]time|login|sign[- ]in|access)\s+(?:code|password|link)\b/i.test(text) ||
    /\b(?:otp|passcode|temporary password|password reset|reset your password|confirm your email|magic link)\b/i.test(text);
}

function redactSensitiveContent(text) {
  return text
    .replace(/\b(?:verification|security|one[- ]time|login|sign[- ]in|access)\s+(?:code|password|link)\b\s*(?:is\s*)?[:#-]?\s*[a-z0-9-]{4,}/gi, "[redacted credential]")
    .replace(/\b(?:otp|passcode|temporary password)\b\s*(?:is\s*)?[:#-]?\s*\S+/gi, "[redacted credential]")
    .replace(/https?:\/\/\S+/gi, "[redacted link]");
}
