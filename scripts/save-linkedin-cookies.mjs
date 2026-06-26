// Open a visible Chrome window with a dedicated profile for LinkedIn.
// Log in once, then close the window. The profile is reused by search-linkedin-jobs.mjs.
//
// Usage:
//   node scripts/save-linkedin-cookies.mjs
//
// This opens Chrome with ~/.linkedin-chrome-profile as the user-data-dir.
// Log in to LinkedIn in that window, then close it (Cmd+Q).
// The session cookies + local storage are persisted for headless reuse.

import { existsSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const PROFILE_DIR = join(homedir(), ".linkedin-chrome-profile");

mkdirSync(PROFILE_DIR, { recursive: true });

const chromePaths = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];

let chrome = null;
for (const p of chromePaths) {
  if (existsSync(p)) {
    chrome = p;
    break;
  }
}

if (!chrome) {
  console.error("No Chrome/Chromium/Edge found in /Applications.");
  process.exit(1);
}

const child = spawn(chrome, [
  `--user-data-dir=${PROFILE_DIR}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-blink-features=AutomationControlled",
  "https://www.linkedin.com/login",
], {
  detached: true,
  stdio: "ignore",
});

child.unref();

console.log("Chrome opened with profile:", PROFILE_DIR);
console.log("");
console.log("1. Log in to LinkedIn in the window that opened.");
console.log("2. After login, close the window (Cmd+Q).");
console.log("3. Your session will be saved for the search script.");
console.log("");
console.log("Verify with: node scripts/search-linkedin-jobs.mjs --dryrun");

process.exit(0);
