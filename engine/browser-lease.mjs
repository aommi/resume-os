// Validate and propagate the inherited POSIX descriptor, not a claimed PID/token.
import { fstatSync, statSync, realpathSync } from 'node:fs';
import { browserOwnershipPath } from './pipeline-handoff.mjs';
export function browserLease(work) {
  const fd = Number(process.env.RESUME_OS_BROWSER_LEASE_FD);
  const path = process.env.RESUME_OS_BROWSER_LEASE_PATH;
  if (!path || !Number.isSafeInteger(fd) || fd < 3) throw Error('Shared browser lease required; use with-browser-ownership.py');
  const a = fstatSync(fd), b = statSync(browserOwnershipPath(work));
  if (realpathSync(path) !== realpathSync(browserOwnershipPath(work)) || a.dev !== b.dev || a.ino !== b.ino) throw Error('Wrong shared browser lease');
  return fd;
}
export function inheritedBrowserStdio(work) {
  const fd = browserLease(work), stdio = ['pipe', 'pipe', 'pipe'];
  while (stdio.length <= fd) stdio.push('ignore');
  stdio[fd] = fd;
  return stdio;
}
