'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pushLink } = require('../desktop/link-push.cjs');

test('sends the public link only to selected PushPlus channels and reports partial failures', async () => {
  const requests = [];
  const address = 'https://borad-test.trycloudflare.com';
  const token = 'example-test-token';
  const result = await pushLink(address, { token, channels: ['wechat', 'qq'] }, async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url, method: options.method, redirect: options.redirect, body });
    return { ok: true, json: async () => ({ code: body.channel === 'wechat' ? 200 : 500, msg: 'private provider response' }) };
  });
  assert.deepEqual(requests.map(request => request.body.channel), ['wechat', 'qq']);
  for (const request of requests) {
    assert.equal(request.url, 'https://www.pushplus.plus/send');
    assert.equal(request.method, 'POST');
    assert.equal(request.redirect, 'error');
    assert.equal(request.body.content, address);
    assert.equal(request.body.token, token);
  }
  assert.deepEqual(result, { sent: ['wechat'], failed: ['qq'] });
  await assert.rejects(pushLink('https://example.test', { channels: ['qq'] }, () => assert.fail('must not send invalid links')));
});
