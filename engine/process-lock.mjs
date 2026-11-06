// Local process ownership; unknown/foreign owners fail closed.
import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
function readOwner(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}
export function acquireProcessLock(path) {
  const owner = { pid: process.pid, hostname: hostname(), token: randomUUID() };
  function create() {
    const fd = openSync(path, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify(owner)); } finally { closeSync(fd); }
  }
  try { create(); } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    // Serialize dead-owner recovery. Malformed/foreign locks always require manual review.
    const recovery = `${path}.recovery`;
    let fd;
    try { fd = openSync(recovery, 'wx', 0o600); writeFileSync(fd, JSON.stringify(owner)); } catch (error) {
      if (fd !== undefined) { closeSync(fd); unlinkSync(recovery); }
      if (error.code !== 'EEXIST') throw error;
      throw Object.assign(new Error('Process resource recovery is locked; a dead recovery owner requires manual review'), { code: 'RESOURCE_LOCKED' });
    }
    try {
      const old = readOwner(path);
      if (old?.hostname === hostname() && Number.isInteger(old.pid) && old.pid > 0 && !alive(old.pid)) unlinkSync(path);
      try { create(); } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        throw Object.assign(new Error('Process resource is locked'), { code: 'RESOURCE_LOCKED' });
      }
    } finally { closeSync(fd); unlinkSync(recovery); }
  }
  return () => { if (readOwner(path)?.token === owner.token) unlinkSync(path); };
}
