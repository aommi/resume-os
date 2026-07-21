// Deterministic identity/contact/link protection for resume Markdown.
// Profile values are authoritative; models may edit prose, never these fields.

export function validateResumeProtectedFacts(markdown, profile = {}) {
  if (!profile || !Object.keys(profile).length) return [];

  const errors = [];
  const contact = profile.contact || {};
  const lines = String(markdown).split(/\r?\n/);
  const name = lines.find((line) => line.startsWith("# "))?.slice(2).trim() ?? "";
  const headlineIndex = lines.findIndex((line) => line.startsWith("**") && line.endsWith("**"));
  const contactLines = lines
    .slice(1, headlineIndex === -1 ? lines.length : headlineIndex)
    .map((line) => line.trim())
    .filter(Boolean);
  const contactBlock = contactLines.join("\n");
  const contactUrls = extractHttpUrls(contactBlock);
  const allUrls = extractHttpUrls(markdown);

  if (!profile.fullName) errors.push("profile.fullName is required for protected-fact validation");
  if (!contact.email) errors.push("profile contact.email is required for protected-fact validation");
  if (name !== profile.fullName) errors.push("resume name does not exactly match profile.fullName");
  if (!contact.phone) errors.push("profile contact.phone is required for protected-fact validation");
  if (!contact.resumeLocation) errors.push("profile contact.resumeLocation is required for protected-fact validation");
  if (!Array.isArray(contact.links)) errors.push("profile contact.links must be a canonical link array");
  if (!Array.isArray(contact.resumeContactLines) || !contact.resumeContactLines.length) {
    errors.push("profile contact.resumeContactLines must define the exact resume contact block");
  } else if (!sameLines(contactLines, contact.resumeContactLines)) {
    errors.push("resume contact block does not exactly match profile contact.resumeContactLines");
  }
  requireExact(contactBlock, contact.email, "email", errors);
  requireExact(contactBlock, contact.phone, "phone", errors);
  requireExact(contactBlock, contact.resumeLocation, "resume location", errors);

  const contactLinks = Array.isArray(contact.links) ? contact.links : [];
  for (const link of contactLinks) {
    const present = /^https?:\/\//i.test(link) ? contactUrls.has(link) : contactBlock.includes(link);
    if (!present) errors.push(`required contact link is missing or changed: ${link}`);
  }

  const resumeLinks = Array.isArray(profile.resumeLinks) ? profile.resumeLinks : [];
  const allowedUrls = new Set([
    ...contactLinks.filter((link) => /^https?:\/\//i.test(link)),
    ...resumeLinks.map((entry) => entry?.url).filter(Boolean),
  ]);

  for (const url of allUrls) {
    if (!allowedUrls.has(url)) errors.push(`resume URL is not canonical/allowlisted: ${url}`);
  }

  for (const entry of resumeLinks) {
    if (!entry?.url || !entry?.requiredWhenText) continue;
    if (String(markdown).includes(entry.requiredWhenText) && !allUrls.has(entry.url)) {
      errors.push(`required URL missing for "${entry.requiredWhenText}": ${entry.url}`);
    }
  }

  return [...new Set(errors)];
}

export function extractHttpUrls(text) {
  const urls = new Set();
  for (const match of String(text).matchAll(/https?:\/\/[^\s)>]+/g)) {
    urls.add(match[0].replace(/[.,;:]$/, ""));
  }
  return urls;
}

function requireExact(haystack, value, label, errors) {
  if (value && !haystack.includes(value)) errors.push(`${label} is missing or changed`);
}

function sameLines(actual, expected) {
  return actual.length === expected.length && actual.every((line, index) => line === String(expected[index]).trim());
}
