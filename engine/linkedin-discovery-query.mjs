export const DEFAULT_LINKEDIN_RECENCY_SECONDS = 86_400;

export function resolveRecencySeconds(since, nowMs = Date.now()) {
  if (!since) return DEFAULT_LINKEDIN_RECENCY_SECONDS;

  const match = String(since).match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/,
  );
  if (!match || !validIsoParts(match)) {
    throw new Error(`Invalid --since ISO timestamp: ${since}`);
  }

  const sinceMs = Date.parse(since);
  if (!Number.isFinite(sinceMs)) throw new Error(`Invalid --since ISO timestamp: ${since}`);
  const seconds = Math.ceil((nowMs - sinceMs) / 1000);
  if (seconds <= 0) throw new Error(`--since must be earlier than now: ${since}`);
  return seconds;
}

export function buildLinkedInSearchUrl(keywords, location, recencySeconds) {
  return (
    "https://www.linkedin.com/jobs/search/?" +
    new URLSearchParams({
      keywords,
      location,
      f_TPR: `r${recencySeconds}`,
      sortBy: "DD",
      start: "0",
    }).toString()
  );
}

export function dedupeSearchResults(jobs) {
  const seen = new Set();
  return jobs.filter((job) => {
    const id = String(job.linkedinJobId || "").trim();
    const url = String(job.url || "").trim();
    const key = id ? `linkedin:${id}` : `url:${url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function validIsoParts(match) {
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return false;
  if (zone !== "Z") {
    const [offsetHour, offsetMinute] = zone.slice(1).split(":").map(Number);
    if (offsetHour > 23 || offsetMinute > 59) return false;
  }
  return true;
}
