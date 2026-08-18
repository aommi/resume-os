#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { workDir } from "../engine/config.mjs";
import { resolveJobIdentity } from "../engine/job-identity.mjs";

const apply = process.argv.includes("--apply");
const inbox = join(workDir(), "inbox");
let changed = 0;
let inspected = 0;

if (existsSync(inbox)) {
  for (const entry of readdirSync(inbox)) {
    const metadataPath = join(inbox, entry, "metadata.json");
    try {
      if (!statSync(join(inbox, entry)).isDirectory() || !existsSync(metadataPath)) continue;
      const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
      inspected += 1;
      const identity = resolveJobIdentity(metadata);
      if (sameIdentity(metadata, identity)) continue;
      changed += 1;
      if (apply) writeJsonAtomic(metadataPath, { ...metadata, ...identity });
    } catch {
      console.error(`skipping unreadable job metadata: ${metadataPath}`);
    }
  }
}

console.log(JSON.stringify({ inspected, changed, applied: apply }, null, 2));

function sameIdentity(metadata, identity) {
  return metadata.linkedinJobId === identity.linkedinJobId &&
    metadata.employerRequisitionId === identity.employerRequisitionId &&
    metadata.employerRequisitionSource === identity.employerRequisitionSource;
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tempPath, JSON.stringify(value, null, 2) + "\n");
  renameSync(tempPath, path);
}
