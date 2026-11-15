'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const http = require('node:http');
const { createApp } = require('../server.cjs');

function remote(port, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path, method, headers: { Host: 'example.test', ...headers } }, response => {
      let text = '';
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: JSON.parse(text) }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

test('desktop session opens locally while public access still requires a password', async () => {
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const source = { refresh: async () => false, history: [], rows: [] };
  const app = createApp({ source, port, password: 'jbc', publicHost: 'example.test' });
  await app.start();
  try {
    const url = `http://127.0.0.1:${port}/api/auth-state`;
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await remote(port, '/api/auth-state')).status, 401);
    const token = app.createDesktopSession();
    const response = await fetch(url, { headers: { Cookie: `_mpr=${token}` } });
    assert.equal(response.status, 200);
    assert.ok((await response.json()).csrf);
    const nextToken = app.createDesktopSession();
    assert.equal(nextToken, token, 'navigation should reuse the desktop session');
    assert.equal((await fetch(url, { headers: { Cookie: `_mpr=${token}` } })).status, 200);
    assert.equal((await remote(port, '/api/auth-state', { headers: { Cookie: `_mpr=${token}` } })).status, 401);
    for (let count = 0; count < 50; count++) {
      const result = await remote(port, '/api/login', {
        method: 'POST',
        headers: { Origin: 'http://example.test', 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'jbc' }),
      });
      assert.equal(result.status, 200);
    }
    assert.equal((await fetch(url, { headers: { Cookie: `_mpr=${token}` } })).status, 200, 'remote session limits must not evict the desktop session');
    const login = await remote(port, '/api/login', {
      method: 'POST',
      headers: { Host: 'example.test', Origin: 'http://example.test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'jbc' }),
    });
    assert.equal(login.status, 200);
    const remoteCookie = login.headers['set-cookie'][0].split(';')[0];
    const remoteSession = login.body;
    const changed = await remote(port, '/api/password', {
      method: 'POST',
      headers: { Host: 'example.test', Origin: 'http://example.test', Cookie: remoteCookie, 'Content-Type': 'application/json', 'X-CSRF-Token': remoteSession.csrf },
      body: JSON.stringify({ currentPassword: 'jbc', newPassword: 'updated' }),
    });
    assert.equal(changed.status, 200);
    assert.equal((await fetch(url, { headers: { Cookie: `_mpr=${token}` } })).status, 200);
  } finally {
    await app.stop();
  }
});
