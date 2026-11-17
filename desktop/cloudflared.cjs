'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const version = '2026.11.0';
const checksum = 'd5c1d82031da6253dcdcff64c944cd0fe063016edeb2e4fd088075fc9bd52d0a';
const url = `https://github.com/cloudflare/cloudflared/releases/download/${version}/cloudflared-windows-amd64.exe`;
const digest = data => crypto.createHash('sha256').update(data).digest('hex');

async function ensureCloudflared({ directory, signal, expected = checksum, download = fetch, candidates = [] }) {
  signal?.throwIfAborted();
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, `cloudflared-${version}.exe`);
  const cached = await fs.readFile(target).catch(() => null);
  signal?.throwIfAborted();
  if (cached && digest(cached) === expected) return target;
  let data;
  for (const candidate of candidates) {
    const existing = await fs.readFile(candidate).catch(() => null);
    signal?.throwIfAborted();
    if (existing && digest(existing) === expected) { data = existing; break; }
  }
  if (!data) {
    const response = await download(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）`);
    data = Buffer.from(await response.arrayBuffer());
  }
  signal?.throwIfAborted();
  if (digest(data) !== expected) throw new Error('下载的公网组件校验失败');
  const temporary = path.join(directory, `.${crypto.randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, data, { flag: 'wx' });
    signal?.throwIfAborted();
    await fs.rename(temporary, target);
    return target;
  } finally { await fs.rm(temporary, { force: true }); }
}
module.exports = { ensureCloudflared };
