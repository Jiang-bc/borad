const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const directory = path.join(__dirname, '..', 'desktop', 'bin');
const expected = 'd5c1d82031da6253dcdcff64c944cd0fe063016edeb2e4fd088075fc9bd52d0a';
const version = '2026.11.0';
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
async function fetchFile(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
async function main() {
  await fs.mkdir(directory, { recursive: true });
  const candidates = [path.join(directory, 'cloudflared.exe'), process.env.CLOUDFLARED_PATH, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe')].filter(Boolean);
  let binary;
  for (const candidate of candidates) {
    try { const data = await fs.readFile(candidate); if (digest(data) === expected) { binary = data; break; } } catch {}
  }
  if (!binary) binary = await fetchFile(`https://github.com/cloudflare/cloudflared/releases/download/${version}/cloudflared-windows-amd64.exe`);
  if (digest(binary) !== expected) throw new Error('Cloudflared SHA256 does not match the official release.');
  await fs.writeFile(path.join(directory, 'cloudflared.exe'), binary);
  const license = await fetchFile(`https://raw.githubusercontent.com/cloudflare/cloudflared/${version}/LICENSE`);
  await fs.writeFile(path.join(directory, 'cloudflared-LICENSE'), license);
  console.log(`Verified cloudflared ${version}; runtime resources prepared.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
