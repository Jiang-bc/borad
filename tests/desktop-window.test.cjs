'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { _electron: electron } = require('playwright-core');

test('desktop opens requests without login and themes update the data view', { timeout: 45000 }, async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const cachedElectron = path.resolve(__dirname, '../dist/electron/electron.exe');
  const executablePath = process.env.BORAD_TEST_EXE || (fs.existsSync(cachedElectron) ? cachedElectron : require('electron'));
  const args = process.env.BORAD_TEST_EXE ? [] : [path.resolve(__dirname, '..')];
  const app = await electron.launch({ args, executablePath, env });
  let window;
  let originalTheme;
  try {
    window = await app.firstWindow();
    originalTheme = await window.locator('#appearance').inputValue();
    await window.getByRole('button', { name: '请求流水', exact: true }).waitFor({ state: 'visible' });
    await window.waitForFunction(() => document.querySelector('[aria-label="请求流水"]')?.getAttribute('aria-current') === 'page');
    const extra = spawn(executablePath, args, { env, windowsHide: true, stdio: 'ignore' });
    const exitCode = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { extra.kill(); reject(new Error('second Borad instance did not exit')); }, 10000);
      extra.on('error', error => { clearTimeout(timer); reject(error); });
      extra.on('close', code => { clearTimeout(timer); resolve(code); });
    });
    assert.equal(exitCode, 0);
    assert.equal(window.isClosed(), false);
    const dashboard = await app.waitForEvent('window', { timeout: 5000 }).catch(() => app.windows().find(page => page.url().includes('127.0.0.1:18790')));
    assert.ok(dashboard, 'data view is available');
    await dashboard.locator('#dashboard').waitFor({ state: 'visible' });
    assert.equal(await dashboard.locator('#login').isVisible(), false);
    assert.equal(await dashboard.evaluate(() => window.scrollY), 0, 'requests open at the top, with filters and summary visible');
    await dashboard.locator('#request-list[aria-busy="false"]').waitFor();
    const payload = '<img src=x onerror="window.__boradXss=1">';
    await dashboard.route('**/api/requests?*', async route => {
      const response = await route.fetch();
      const data = await response.json();
      data.rows = [{ ...(data.rows[0] || { id: 'security-test', status: 'success', time: new Date().toISOString() }), requestedModel: payload }];
      await route.fulfill({ response, json: data });
    });
    await dashboard.locator('#refresh').click();
    await dashboard.waitForFunction(value => document.querySelector('#request-list .model')?.textContent?.includes(value), payload);
    assert.ok((await dashboard.locator('#request-list .model').first().textContent()).includes(payload));
    assert.equal(await dashboard.locator('#request-list img').count(), 0);
    assert.equal(await dashboard.evaluate(() => window.__boradXss), undefined);
    await dashboard.unroute('**/api/requests?*');
    for (const theme of ['claude', 'github', 'google', 'forest']) {
      await window.locator('#appearance').selectOption(theme);
      await dashboard.waitForFunction(value => document.documentElement.dataset.theme === value, theme);
    }
    assert.equal(await dashboard.locator('.view-tabs').isVisible(), false);
    await window.getByRole('button', { name: 'Token 用量', exact: true }).click();
    await dashboard.locator('#view-tokens').waitFor({ state: 'visible' });
    await window.getByRole('button', { name: '剩余额度', exact: true }).click();
    await dashboard.locator('#view-quota').waitFor({ state: 'visible' });
    for (let count = 0; count < 3; count++) {
      await window.getByRole('button', { name: '请求流水', exact: true }).click();
      await dashboard.locator('#view-requests').waitFor({ state: 'visible' });
      await window.getByRole('button', { name: 'Token 用量', exact: true }).click();
      await dashboard.locator('#view-tokens').waitFor({ state: 'visible' });
      assert.equal(await dashboard.locator('#login').isVisible(), false);
    }
    await window.getByRole('button', { name: '口令与显示设置' }).click();
    await dashboard.locator('#view-settings').waitFor({ state: 'visible' });
    await window.getByRole('button', { name: '首页', exact: true }).click();
    await window.getByRole('switch', { name: '打开 Borad 时自动开启公网分享', exact: true }).waitFor();
    await window.getByText('公网链接推送', { exact: false }).first().click();
    await window.locator('#push-token').waitFor({ state: 'visible' });
    await window.setViewportSize({ width: 640, height: 700 });
    assert.equal(await window.locator('body').evaluate(element => element.scrollWidth <= window.innerWidth), true);
  } finally {
    if (window && originalTheme) await window.locator('#appearance').selectOption(originalTheme).catch(() => {});
    await app.close();
  }
});
