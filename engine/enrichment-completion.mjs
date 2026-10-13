// A small output-format contract, not a general YAML parser or JD-quality judge.
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

function scalar(value) {
  const text = value.trim();
  if (/^"[^"\n]*"$/.test(text) || /^'[^'\n]*'$/.test(text)) return text.slice(1, -1);
  return text;
}

export function isEnrichmentComplete(dir, metadata) {
  try {
    metadata ??= JSON.parse(readFileSync(join(dir, 'metadata.json'), 'utf8'));
    if (typeof metadata.enrichedAt !== 'string' || !Number.isFinite(Date.parse(metadata.enrichedAt))) return false;
    const text = readFileSync(join(dir, 'enrichment.md'), 'utf8').replace(/\r\n/g, '\n');
    const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return false;
    const lines = match[1].split('\n');
    const ids = lines.filter(line => /^jobId:/.test(line));
    if (ids.length !== 1 || scalar(ids[0].slice('jobId:'.length)) !== basename(dir)) return false;
    const blocks = lines.reduce((indices, line, index) => {
      if (/^enrichment:\s*$/.test(line)) indices.push(index);
      return indices;
    }, []);
    if (blocks.length !== 1) return false;
    const fields = [];
    for (let i = blocks[0] + 1; i < lines.length; i++) {
      if (/^\S/.test(lines[i])) break;
      if (/^  jdCompleteness:/.test(lines[i])) fields.push(scalar(lines[i].slice('  jdCompleteness:'.length)));
    }
    if (fields.length !== 1 || !['full', 'partial'].includes(fields[0])) return false;
    const jd = match[2].match(/^## Job Description\s*\n([\s\S]*?)(?=^#{1,2} |$(?![\s\S]))/m);
    return Boolean(jd?.[1].trim());
  } catch { return false; }
}
