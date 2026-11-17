const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const directory = path.join(__dirname, '..', 'desktop', 'bin');
const expectedLicense = '58d1e17ffe5109a7ae296caafcadfdbe6a7d176f0bc4ab01e12a689b0499d8bd';
const version = '2026.11.0';
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
async function fetchFile(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
async function main() {
  await fs.mkdir(directory, { recursive: true });
  const licensePath = path.join(directory, 'cloudflared-LICENSE');
  const cachedLicense = await fs.readFile(licensePath).catch(() => null);
  if (!cachedLicense || digest(cachedLicense) !== expectedLicense) {
    const license = await fetchFile(`https://raw.githubusercontent.com/cloudflare/cloudflared/${version}/LICENSE`);
    if (digest(license) !== expectedLicense) throw new Error('Cloudflared license SHA256 does not match the official release.');
    await fs.writeFile(licensePath, license);
  }
  console.log(`Verified cloudflared ${version} license.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
