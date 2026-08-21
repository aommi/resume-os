#!/usr/bin/env node

import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { finalizeDiscoveryBoundary } from "../engine/linkedin-discovery-boundary.mjs";
import { resolveRecencySeconds } from "../engine/linkedin-discovery-query.mjs";

if (isMain()) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const runStartedAtMs = parseRunStart(options.runStart);
    const result = finalizeDiscoveryBoundary({
      path: join(dirname(fileURLToPath(import.meta.url)), "..", ".linkedin-last-checked"),
      expectedMs: parseExpected(options.expected),
      runStartedAtMs,
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(error.code === "BOUNDARY_CONFLICT" ? 3 : 2);
  }
}

function parseArgs(args) {
  const options = { expected: "", runStart: "" };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--expected") options.expected = args[++index] || "";
    else if (args[index] === "--run-start") options.runStart = args[++index] || "";
  }
  if (!options.expected || !options.runStart) {
    throw new Error("usage: finalize-linkedin-discovery.mjs --expected <epoch-ms|missing> --run-start <ISO timestamp>");
  }
  return options;
}

function parseExpected(value) {
  if (value === "missing") return null;
  if (!/^\d+$/.test(value)) throw new Error("--expected must be epoch milliseconds or missing");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error("--expected must be positive epoch milliseconds");
  return parsed;
}

function parseRunStart(value) {
  resolveRecencySeconds(value);
  return Date.parse(value);
}

function isMain() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}
