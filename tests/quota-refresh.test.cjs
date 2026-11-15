'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');

test('quota refresh keeps existing cards in place while updating data', async () => {
  const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><head><meta name="theme-color" content="#fff"></head><body>
      <div id="quota-account-list"></div><span id="quota-account-count"></span><select id="quota-provider"></select>
      <span id="quota-count"></span><div id="quota-cards"></div><span id="quota-refresh-state"></span>
      <span id="quota-notice"></span><span id="quota-read-time"></span><button id="quota-refresh"></button><span id="updated"></span>
    </body></html>`);
    await page.addScriptTag({ content: `const $ = id => document.getElementById(id); const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character])); const number = value => Number(value).toLocaleString('zh-CN'); function readConnection() {}` });
    await page.addScriptTag({ path: path.resolve(__dirname, '../public/quota-view.js') });
    const result = await page.evaluate(() => {
      const card = (provider, remaining) => ({ provider, name: provider, accountCount: 1, windows: [{ name: '额度', remaining }], balances: [] });
      const data = cards => ({ accounts: [], cards, refresh: { perProvider: {} } });
      renderQuotas(data([card('alpha', 90), card('beta', 80), card('gamma', 70)]));
      const before = [...document.querySelectorAll('.quota-card')];
      renderQuotas(data([card('gamma', 65), card('alpha', 90), card('beta', 75)]));
      const after = [...document.querySelectorAll('.quota-card')];
      return { names: after.map(element => element.querySelector('h2').textContent), same: after.map((element, index) => element === before[index]), text: after.map(element => element.textContent) };
    });
    assert.deepEqual(result.names, ['alpha', 'beta', 'gamma']);
    assert.deepEqual(result.same, [true, true, true]);
    assert.match(result.text[1], /75%/);
    assert.match(result.text[2], /65%/);
  } finally { await browser.close(); }
});
