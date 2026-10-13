// Applycling's structured-first extraction, without provider calls or credentials.
export function plainText(value = '') {
  return String(value).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<\/(?:p|div|li|h[1-6])\s*>|<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => { const v = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n); return v > 0 && v <= 0x10ffff ? String.fromCodePoint(v) : ''; })
    .replace(/&(amp|quot|apos|lt|gt|nbsp);/g, (_, k) => ({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '})[k]).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
export function extractJobPostings(html) {
  const jobs = [];
  function walk(value) {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    if ([value['@type']].flat().includes('JobPosting')) {
      const identifier = value.identifier;
      const description = plainText(value.description);
      const labeledId = description.match(/\b(?:Job Requisition ID|Requisition ID|Requisition Number)\s*[:#]?\s*([A-Z0-9][A-Z0-9_-]{3,})\b/i)?.[1] || '';
      jobs.push({ title: plainText(value.title), company: plainText(value.hiringOrganization?.name),
        description, requisitionId: typeof identifier === 'string' ? identifier : String(identifier?.value || labeledId),
        postedAt: value.datePosted || null, sourceType: 'JobPosting' });
    }
    if (value['@graph']) walk(value['@graph']);
  }
  for (const m of String(html).matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1])); } catch { /* malformed blocks are not evidence */ }
  }
  return jobs;
}
const normalized = value => plainText(value).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
export function matchJobPosting(jobs, expected) {
  // Strict equality is deliberate. Skills resolve spelling/title variations; code does not guess.
  if (!normalized(expected.company)) return null;
  const matches = jobs.filter(job => normalized(job.description) && normalized(job.title) && normalized(job.company) && normalized(job.company) === normalized(expected.company) &&
    (expected.employerRequisitionId
      ? Boolean(job.requisitionId) && normalized(job.requisitionId) === normalized(expected.employerRequisitionId)
      : normalized(job.title) === normalized(expected.title)));
  return matches.length === 1 ? matches[0] : null;
}
export function externalJobUrl(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || /(^|\.)(linkedin\.com|localhost|local)$/.test(u.hostname) || /^\[|^\d+\./.test(u.hostname) || !u.hostname.includes('.')) return null;
    u.hash = ''; return u.href;
  } catch { return null; }
}
export function employerPostingKey(value) {
  const safe = externalJobUrl(value); if (!safe) return null;
  const u = new URL(safe);
  for (const key of [...u.searchParams.keys()]) if (/^(utm_.+|src|source|domain|trackingId|refId)$/i.test(key)) u.searchParams.delete(key);
  u.pathname = u.pathname.replace(/\/apply\/?$/, '').replace(/\/$/, '');
  u.searchParams.sort(); return u.href;
}
