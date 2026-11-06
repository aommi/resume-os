#!/usr/bin/env python3
"""POSIX shared-browser command lease. Never unlink the kernel-lock inode.

The descriptor is inherited by the command: killing this wrapper cannot make a
still-running command's browser session appear abandoned. No PID/age takeover.
"""
import argparse
import fcntl
import json
import os
import signal
import subprocess
import sys
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--lock', required=True)
    parser.add_argument('--policy')
    parser.add_argument('--config')
    parser.add_argument('--stop', action='append', default=[])
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command:
        parser.error('command required')
    os.makedirs(os.path.dirname(os.path.abspath(args.lock)), exist_ok=True)
    fd = os.open(args.lock, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('BROWSER_BUSY', file=sys.stderr)
            return 75
        def authorized():
            if any(os.path.exists(p) for p in args.stop):
                return False
            if not args.policy:
                return True
            try:
                with open(args.policy) as source:
                    policy = json.load(source)
                with open(args.config) as source:
                    config = json.load(source).get('pipelineHandoff', {})
                return policy.get('enabled') is True and policy.get('paused') is not True and config.get('enabled') is True
            except (OSError, ValueError, AttributeError):
                return False

        # Re-read after acquiring ownership, not before waiting for it.
        if not authorized():
            print('HANDOFF_REVOKED', file=sys.stderr)
            return 77
        child = subprocess.Popen(command, pass_fds=(fd,), start_new_session=True)

        stopping = False

        def stop(_signum, _frame):
            nonlocal stopping
            stopping = True

        def signal_group(signum):
            try:
                os.killpg(child.pid, signum)
            except ProcessLookupError:
                pass

        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        while child.poll() is None:
            if stopping or not authorized():
                signal_group(signal.SIGTERM)
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    pass
                # Also clean up descendants if the foreground child exited first.
                signal_group(signal.SIGKILL)
                child.wait()
                # Execution began: cancellation is uncertain, NOT a safe retry.
                print('HANDOFF_CANCELLED', file=sys.stderr)
                return 78
            time.sleep(0.1)
        return child.returncode
    finally:
        os.close(fd)


if __name__ == '__main__':
    sys.exit(main())
