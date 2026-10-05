// Detect access barriers before interpreting a page as job data.
export async function assertLinkedInSession(page) {
  const url = page.url();
  const title = await page.title();
  const challenge = /\/(?:checkpoint|authwall|login|uas\/login)(?:[/?]|$)/i.test(url) ||
    /sign in|join linkedin|security verification/i.test(title) ||
    await page.evaluate(() => Boolean(document.querySelector('iframe[src*="captcha"], input[name="session_password"]')));
  if (challenge) throw new Error('LINKEDIN_AUTH_REQUIRED: sign in or complete verification manually with node scripts/save-linkedin-cookies.mjs, then retry. Automation stopped.');
}
