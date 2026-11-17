'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { ensureCloudflared } = require('../desktop/cloudflared.cjs');

test('downloads a verified component once and reuses the cache', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'borad-cloudflared-'));
  const data = Buffer.from('verified component');
  const expected = crypto.createHash('sha256').update(data).digest('hex');
  let requests = 0;
  const download = async () => { requests++; return new Response(data); };
  try {
    const target = await ensureCloudflared({ directory, expected, download });
    assert.deepEqual(await fs.readFile(target), data);
    assert.equal(await ensureCloudflared({ directory, expected, download }), target);
    assert.equal(requests, 1);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('rejects corrupt downloads and never caches them', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'borad-cloudflared-'));
  try {
    await assert.rejects(ensureCloudflared({ directory, expected: '0'.repeat(64), download: async () => new Response('bad') }), /校验/);
    assert.deepEqual(await fs.readdir(directory), []);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('cancelled download is not stored', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'borad-cloudflared-'));
  const controller = new AbortController();
  controller.abort();
  try {
    await assert.rejects(ensureCloudflared({ directory, signal: controller.signal }));
    assert.deepEqual(await fs.readdir(directory), []);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('replaces a corrupted cache with a verified download', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'borad-cloudflared-'));
  const data = Buffer.from('replacement');
  const expected = crypto.createHash('sha256').update(data).digest('hex');
  const download = async () => new Response(data);
  try {
    const target = await ensureCloudflared({ directory, expected, download });
    await fs.writeFile(target, 'corrupted');
    assert.equal(await ensureCloudflared({ directory, expected, download }), target);
    assert.deepEqual(await fs.readFile(target), data);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('uses a verified installed component without downloading', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'borad-cloudflared-'));
  const data = Buffer.from('installed component');
  const expected = crypto.createHash('sha256').update(data).digest('hex');
  const source = path.join(directory, 'installed.exe');
  const cache = path.join(directory, 'cache');
  try {
    await fs.writeFile(source, data);
    const target = await ensureCloudflared({ directory: cache, expected, candidates: [source], download: () => { throw new Error('unexpected download'); } });
    assert.deepEqual(await fs.readFile(target), data);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
