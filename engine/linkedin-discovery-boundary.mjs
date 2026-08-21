import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";

export function readDiscoveryBoundary(path) {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8").trim();
  if (!/^\d+$/.test(raw)) throw new Error(`discovery boundary is not epoch milliseconds: ${raw || "(blank)"}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`discovery boundary is not valid epoch milliseconds: ${raw}`);
  }
  return value;
}

export function finalizeDiscoveryBoundary({ path, expectedMs, runStartedAtMs }) {
  if (expectedMs !== null && (!Number.isSafeInteger(expectedMs) || expectedMs <= 0)) {
    throw new Error("expected boundary must be positive epoch milliseconds or null");
  }
  if (!Number.isSafeInteger(runStartedAtMs) || runStartedAtMs <= 0) {
    throw new Error("run start must be positive epoch milliseconds");
  }

  const lockPath = `${path}.lock`;
  let lockHandle;
  try {
    lockHandle = acquireBoundaryLock(lockPath);

    const currentMs = readDiscoveryBoundary(path);
    if (currentMs !== expectedMs) {
      const error = new Error(`discovery boundary changed during sweep: expected ${format(expectedMs)}, found ${format(currentMs)}`);
      error.code = "BOUNDARY_CONFLICT";
      throw error;
    }
    if (runStartedAtMs <= (currentMs || 0)) {
      throw new Error(`run start ${runStartedAtMs} would not advance boundary ${format(currentMs)}`);
    }

    const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
    try {
      writeFileSync(tempPath, `${runStartedAtMs}\n`, { mode: 0o600 });
      renameSync(tempPath, path);
    } finally {
      try { unlinkSync(tempPath); } catch {}
    }
    return { previousMs: currentMs, currentMs: runStartedAtMs };
  } finally {
    if (lockHandle !== undefined) {
      closeSync(lockHandle);
      try { unlinkSync(lockPath); } catch {}
    }
  }
}

function acquireBoundaryLock(lockPath) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let handle;
    try {
      handle = openSync(lockPath, "wx", 0o600);
      writeFileSync(handle, `${process.pid} ${Date.now()}\n`);
      return handle;
    } catch (cause) {
      if (handle !== undefined) {
        closeSync(handle);
        try { unlinkSync(lockPath); } catch {}
      }
      if (cause.code === "EEXIST" && attempt === 0 && isStaleLock(lockPath)) {
        try { unlinkSync(lockPath); } catch {}
        continue;
      }
      const error = new Error(`discovery boundary is being finalized by another process: ${lockPath}`);
      error.code = "BOUNDARY_CONFLICT";
      error.cause = cause;
      throw error;
    }
  }
  throw new Error(`could not acquire discovery boundary lock: ${lockPath}`);
}

function isStaleLock(lockPath, nowMs = Date.now()) {
  const maxAgeMs = 5 * 60 * 1000;
  try {
    const raw = readFileSync(lockPath, "utf8").trim();
    const match = raw.match(/^(\d+)\s+(\d+)$/);
    if (!match) return nowMs - statSync(lockPath).mtimeMs > maxAgeMs;
    const pid = Number(match[1]);
    const createdAtMs = Number(match[2]);
    if (nowMs - createdAtMs <= maxAgeMs) return false;
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      return error.code === "ESRCH";
    }
  } catch {
    return false;
  }
}

function format(value) {
  return value === null ? "missing" : String(value);
}
