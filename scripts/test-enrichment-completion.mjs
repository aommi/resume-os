#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { isEnrichmentComplete } from '../engine/enrichment-completion.mjs';

const root = mkdtempSync(join(tmpdir(), 'enrichment-contract-'));
const dir = join(root, 'inbox', '123');
const script = fileURLToPath(new URL('./enrich-job.mjs', import.meta.url));
const metadata = { linkedinJobId: '123', url: 'https://www.linkedin.com/jobs/view/123/', enrichedAt: '2026-10-12' };
const document = (quality = 'full', id = '123', body = 'A factual job description.') => `---\njobId: "${id}"\nenrichment:\n  jdCompleteness: ${quality}\n---\n# A role\n\n## Job Description\n\n${body}\n\n## Application Questions\n\nNot shown.\n`;
function save(text, meta = metadata) {
  writeFileSync(join(dir, 'metadata.json'), JSON.stringify(meta));
  writeFileSync(join(dir, 'enrichment.md'), text);
}
function route() { return JSON.parse(execFileSync(process.execPath, [script, '123'], { cwd: root, encoding: 'utf8' })); }
try {
  mkdirSync(dir, { recursive: true });
  save('Partial model output', { ...metadata, enrichedAt: undefined });
  assert.equal(route().alreadyEnriched, false, 'file-only partial output must be retried');
  save(document());
  assert.equal(route().alreadyEnriched, true, 'valid output must skip redundant extraction');
  save(document('blocked'));
  assert.equal(route().alreadyEnriched, false, 'blocked source must never count as complete');
  save(document('partial'));
  assert.equal(isEnrichmentComplete(dir), true, 'honest partial evidence meets the structural contract');
  for (const invalid of [document('full', '999'), document('full', '123', ''), '---\njobId: 123\n---\n## Job Description\nText', document().replace('enrichment:', 'other:'), document().replace('jobId: "123"', 'jobId: "123"\njobId: "999"')]) {
    save(invalid); assert.equal(isEnrichmentComplete(dir), false);
  }
  save(document(), { ...metadata, enrichedAt: undefined });
  assert.equal(isEnrichmentComplete(dir), false);
  console.log('Enrichment completion: routing, partial recovery, blocked rejection, exact identity, and output-format checks passed.');
} finally { rmSync(root, { recursive: true, force: true }); }
