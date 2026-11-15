'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { createApp } = require('../server.cjs');

test('port conflict does not leave a data refresh timer running', async () => {
  const occupied = net.createServer();
  await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
  const port = occupied.address().port;
  let reads = 0;
  const source = { refresh: async () => { reads++; return false; } };
  const app = createApp({ source, port });
  try {
    await assert.rejects(app.start(), { code: 'EADDRINUSE' });
    await delay(3200);
    assert.equal(reads, 1);
  } finally {
    await app.stop();
    await new Promise(resolve => occupied.close(resolve));
  }
});

test('a background data refresh failure does not crash the service', { timeout: 10000 }, async () => {
  const script = `
    const { createApp } = require('./server.cjs');
    let calls = 0;
    const source = { refresh: async () => { if (++calls > 1) throw new Error('simulated refresh failure'); return false; } };
    const app = createApp({ source, port: 0 });
    app.start().then(() => setTimeout(async () => { console.log('survived'); await app.stop(); }, 3500));
  `;
  const child = spawn(process.execPath, ['--unhandled-rejections=strict', '-e', script], { cwd: path.resolve(__dirname, '..'), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  assert.equal(code, 0, stderr);
  assert.match(stdout, /survived/);
});
