// ATS credentials stay in the macOS login keychain, never in manifests or model logs.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { employerUrl } from './auto-apply.mjs';
export function accountPassword({ origin, profileId, email, createIfMissing = false, exec = execFileSync }) {
  const url = employerUrl(origin), service = `resume-os.application:${profileId}:${url.origin}`;
  try { return exec('/usr/bin/security', ['find-generic-password','-s',service,'-a',email,'-w'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim(); }
  catch (error) { if (error.status !== 44) throw Error('ATS keychain access failed; account needs review'); }
  if (!createIfMissing) throw Error('No saved ATS account credential; confirm account access before retrying');
  const password = `R!${randomBytes(24).toString('base64url')}8a`;
  try {exec('/usr/bin/security',['add-generic-password','-s',service,'-a',email,'-w',password],{stdio:['ignore','pipe','pipe']});}
  catch {throw Error('Could not save ATS credential to keychain');}
  return password;
}
