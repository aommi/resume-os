import { readlinkSync, unlinkSync } from 'node:fs';
import { hostname } from 'node:os';

export function clearDeadChromeLock(path) {
  let target;
  try { target = readlinkSync(path); } catch (error) {
    if (error.code === 'ENOENT') return;
    throw new Error('LinkedIn Chrome lock cannot be verified; close its Chrome window before retrying');
  }
  const match = target.match(/^(.*)-(\d+)$/);
  if (!match || match[1] !== hostname()) throw new Error('LinkedIn Chrome profile has an unfamiliar lock; refusing to remove it');
  try { process.kill(Number(match[2]), 0); } catch (error) {
    if (error.code === 'ESRCH') { unlinkSync(path); return; }
    throw error;
  }
  throw new Error('LinkedIn Chrome profile is in use; close its Chrome window before retrying');
}
