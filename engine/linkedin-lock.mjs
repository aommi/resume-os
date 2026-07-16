import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { workDir } from "./config.mjs";

const STALE_MS = 10 * 60 * 1000;

export function linkedInLockPath(work = workDir()) {
  return join(work, "locks", "linkedin.lock");
}

export function readLinkedInLock(work = workDir()) {
  const path = linkedInLockPath(work);
  if (!existsSync(path)) return null;
  try {
    return { path, ...JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    return { path, workflow: "unknown", pid: null, acquiredAt: "" };
  }
}

export function acquireLinkedInLock(workflow, { work = workDir(), now = new Date() } = {}) {
  const path = linkedInLockPath(work);
  mkdirSync(join(work, "locks"), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = randomUUID();
    let fd;
    try {
      fd = openSync(path, "wx", 0o600);
      writeFileSync(fd, JSON.stringify({ pid: process.pid, workflow, acquiredAt: now.toISOString(), token }) + "\n");
      closeSync(fd);
      return {
        acquired: true,
        path,
        release() {
          try {
            const current = JSON.parse(readFileSync(path, "utf8"));
            if (current.token === token) unlinkSync(path);
          } catch {}
        },
      };
    } catch (error) {
      if (fd !== undefined) try { closeSync(fd); } catch {}
      if (error.code !== "EEXIST") throw error;
      const holder = readLinkedInLock(work);
      if (attempt === 0 && isStaleDeadLock(holder, path, now)) {
        try { unlinkSync(path); } catch {}
        continue;
      }
      return { acquired: false, path, holder, release() {} };
    }
  }
  return { acquired: false, path, holder: readLinkedInLock(work), release() {} };
}

function isStaleDeadLock(holder, path, now) {
  let ageMs = Infinity;
  try {
    const acquired = new Date(holder?.acquiredAt || "").getTime();
    ageMs = Number.isFinite(acquired) ? now.getTime() - acquired : now.getTime() - statSync(path).mtimeMs;
  } catch {}
  return ageMs > STALE_MS && !isPidAlive(holder?.pid);
}

function isPidAlive(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
