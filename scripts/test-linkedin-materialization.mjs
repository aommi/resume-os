import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { resolveBrowserPath } from '../engine/config.mjs';
import { materializeSearchCards } from './search-linkedin-jobs.mjs';
const browser = await chromium.launch({ executablePath: resolveBrowserPath(), headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<div id="list" style="height:300px;overflow-y:auto"><div id="rows" style="height:1500px;position:relative"></div></div>');
  await page.evaluate(() => {
    const list = document.querySelector('#list'), rows = document.querySelector('#rows');
    function render() {
      const first = Math.min(18, Math.floor(list.scrollTop / 60));
      rows.innerHTML = Array.from({ length: 7 }, (_, i) => {
        const n = first + i;
        return `<div role="button" componentkey="job-card-component-ref-${100 + n}" style="position:absolute;top:${n * 60}px;height:60px"><p><span aria-hidden="true">Engineer ${n}</span></p><p>Example</p><p>Remote</p></div>`;
      }).join('');
    }
    list.addEventListener('scroll', render); render();
  });
  const result = await materializeSearchCards(page, () => {});
  assert.equal(result.complete, true);
  assert.equal(result.jobs.length, 25);
  assert.deepEqual(result.jobs.map(j => j.linkedinJobId).sort(), Array.from({ length: 25 }, (_, i) => String(i + 100)));
  await page.setContent('<div role="button" componentkey="job-card-component-ref-123"><p><span aria-hidden="true">Engineer</span></p><p>Example</p><p>Remote</p></div>');
  assert.equal((await materializeSearchCards(page, () => {})).complete, false);
  console.log('Real DOM virtualization: all 25 IDs collected from seven mounted rows; unknown scrolling fails closed.');
} finally { await browser.close(); }
