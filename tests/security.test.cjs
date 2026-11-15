'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { createApp } = require('../server.cjs');
const { normalizeHistory, normalizeTrace, queryRows } = require('../data.cjs');

async function fixture() {
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const source = { refresh: async () => false, history: [], rows: [], version: 1, meta: {} };
  const app = createApp({ source, port, password: 'test-password', publicHost: 'example.test', quota: { read: async () => ({}), refresh: () => {} } });
  await app.start();
  const request = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers: { Host: 'example.test', ...headers } }, res => {
      let content = '';
      res.on('data', chunk => { content += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, content }));
    });
    req.on('error', reject);
    req.end(body);
  });
  const login = async () => {
    const response = await request('/api/login', { method: 'POST', headers: { Origin: 'https://example.test', 'X-Forwarded-Proto': 'https', 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test-password' }) });
    assert.equal(response.status, 200);
    return { cookie: response.headers['set-cookie'][0].split(';')[0], csrf: JSON.parse(response.content).csrf, setCookie: response.headers['set-cookie'][0] };
  };
  return { app, port, request, login };
}

test('rejects untrusted hosts, cross-site requests, and unauthenticated data access', async () => {
  const { app, request } = await fixture();
  try {
    assert.equal((await request('/api/health', { headers: { Host: 'attacker.test' } })).status, 403);
    assert.equal((await request('/api/requests')).status, 401);
    assert.equal((await request('/api/requests', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal((await request('/api/login', { method: 'POST', headers: { Origin: 'https://attacker.test', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal((await request('/server.cjs')).status, 404);
    assert.equal((await request('/../../credentials.cjs')).status, 404);
  } finally { await app.stop(); }
});

test('enforces CSRF, secure cookies, and logout invalidation', async () => {
  const { app, request, login } = await fixture();
  try {
    const session = await login();
    assert.match(session.setCookie, /HttpOnly/);
    assert.match(session.setCookie, /SameSite=Strict/);
    assert.match(session.setCookie, /Secure/);
    const headers = { Cookie: session.cookie, Origin: 'https://example.test', 'X-Forwarded-Proto': 'https', 'Content-Type': 'application/json' };
    assert.equal((await request('/api/logout', { method: 'POST', headers, body: '{}' })).status, 403);
    assert.equal((await request('/api/logout', { method: 'POST', headers: { ...headers, 'X-CSRF-Token': 'wrong' }, body: '{}' })).status, 403);
    assert.equal((await request('/api/logout', { method: 'POST', headers: { ...headers, 'X-CSRF-Token': session.csrf }, body: '{}' })).status, 200);
    assert.equal((await request('/api/auth-state', { headers: { Cookie: session.cookie } })).status, 401);
  } finally { await app.stop(); }
});

test('rejects malformed, oversized and non-JSON requests without stopping the service', async () => {
  const { app, request } = await fixture();
  try {
    const headers = { Origin: 'http://example.test', 'Content-Type': 'application/json' };
    assert.equal((await request('/api/login', { method: 'POST', headers, body: '{' })).status, 400);
    assert.equal((await request('/api/login', { method: 'POST', headers, body: JSON.stringify({ password: 'x'.repeat(5000) }) })).status, 400);
    assert.equal((await request('/api/login', { method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain' }, body: '{}' })).status, 400);
    assert.equal((await request('/api/health')).status, 200);
  } finally { await app.stop(); }
});

test('rate-limits repeated incorrect passwords', async () => {
  const { app, request } = await fixture();
  try {
    const options = { method: 'POST', headers: { Origin: 'http://example.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'incorrect' }) };
    for (let attempt = 0; attempt < 5; attempt++) assert.equal((await request('/api/login', options)).status, 401);
    const locked = await request('/api/login', options);
    assert.equal(locked.status, 429);
    assert.ok(Number(locked.headers['retry-after']) > 0);
  } finally { await app.stop(); }
});

test('request output masks account identifiers and excludes raw sensitive fields', () => {
  const history = normalizeHistory({
    t: '2026-01-01T00:00:00Z', provider: 'provider', providerAccount: 'private-account@example.test',
    model: 'model', req: 'model', status: 200, prompt: 'private-prompt', apiKey: 'private-api-key',
  });
  const trace = normalizeTrace({
    time: '2026-01-01T00:00:00Z', done: true, status: 200,
    order: [{ id: 1, provider: 'provider', who: 'private-account@example.test' }],
    tries: [{ id: 1, done: true, status: 200, prompt: 'private-prompt', apiKey: 'private-api-key' }],
  });
  const output = JSON.stringify(queryRows([history, trace], new URLSearchParams()));
  assert.doesNotMatch(output, /private-account@example\.test|private-prompt|private-api-key/);
  assert.match(output, /账号 · /);
});

test('handles concurrent requests and extreme filter values without losing availability', async () => {
  const { app, port, request } = await fixture();
  try {
    const token = app.createDesktopSession();
    const headers = { Host: `127.0.0.1:${port}`, Cookie: `_mpr=${token}` };
    const responses = await Promise.all(Array.from({ length: 100 }, () => request('/api/requests?page=999999999999&size=-1&q=' + 'x'.repeat(1000), { headers })));
    assert.ok(responses.every(response => response.status === 200));
    const data = JSON.parse(responses[0].content);
    assert.equal(data.page, 1);
    assert.equal(data.size, 10);
    assert.equal((await request('/api/health')).status, 200);
  } finally { await app.stop(); }
});
