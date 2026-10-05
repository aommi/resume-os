// Serialized into the browser by Playwright; keep this function self-contained.
export function readLinkedInSearchCards() {
  const modern = [...document.querySelectorAll('[role="button"][componentkey^="job-card-component-ref-"]')];
  const seen = new Set();
  const results = [];
  const add = (id, title, company, location, text) => {
    if (!id || !title || seen.has(id)) return;
    seen.add(id);
    const time = text.match(/(\d+\s+(?:minute|hour|day|week|month)s?\s+ago|Just now|\d+[dhm]\s+ago)/i);
    results.push({ linkedinJobId: id, url: `https://www.linkedin.com/jobs/view/${id}/`, title, company, location, postedTimeAgo: time?.[1] || null });
  };
  for (const card of modern) {
    const id = card.getAttribute('componentkey').match(/^job-card-component-ref-(\d+)$/)?.[1];
    const paragraphs = [...card.querySelectorAll('p')];
    const dismiss = card.querySelector('button[aria-label^="Dismiss "]')?.getAttribute('aria-label');
    const title = dismiss?.replace(/^Dismiss /, '').replace(/ job$/, '') ||
      paragraphs[0]?.querySelector('span[aria-hidden="true"]')?.textContent.trim();
    add(id, title, paragraphs[1]?.textContent.trim() || '', paragraphs[2]?.textContent.trim() || '', card.innerText);
  }
  if (modern.length) return results;
  // Legacy cards only: a detail-pane link is not a search result.
  for (const card of document.querySelectorAll('li[data-occludable-job-id], [data-job-id], .job-card-container')) {
    const link = card.querySelector('a[href*="/jobs/view/"]');
    const id = link?.getAttribute('href')?.match(/\/jobs\/view\/(\d+)(?:\/|\?|$)/)?.[1];
    const title = (link?.querySelector('strong')?.textContent || link?.textContent || '').trim();
    const company = card.querySelector('.artdeco-entity-lockup__subtitle, .job-card-container__primary-description')?.textContent.trim() || '';
    const location = card.querySelector('.artdeco-entity-lockup__caption, .job-card-container__metadata-item')?.textContent.trim() || '';
    add(id, title, company, location, card.innerText);
  }
  return results;
}
