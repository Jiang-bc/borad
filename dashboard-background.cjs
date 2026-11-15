'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createApp } = require('./server.cjs');
const { credentialsPath } = require('./credentials.cjs');

const stateDir = path.join(process.env.LOCALAPPDATA || process.env.USERPROFILE, 'MagpieDashboard');
const addressFile = path.join(__dirname, 'tunnel-address.txt');
const tunnelExecutable = process.env.CLOUDFLARED_PATH || path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe');
fs.mkdirSync(stateDir, { recursive: true });
const log = fs.createWriteStream(path.join(stateDir, 'dashboard.log'), { flags: 'a' });
const report = message => log.write(`${new Date().toISOString()} ${message}\n`);

process.env.MAGPIE_INSTANCE = 'magpie-dashboard-managed-v1';
const app = createApp({ password: 'jbc', credentialsFile: credentialsPath() });
let tunnel;
let retry;
let stopping = false;
let started = false;

function clearAddress() {
  try { fs.unlinkSync(addressFile); } catch (error) { if (error.code !== 'ENOENT') report(`Address cleanup failed: ${error.message}`); }
}

function startTunnel() {
  if (stopping) return;
  report('Starting Cloudflare tunnel');
  tunnel = spawn(tunnelExecutable, ['tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:8790'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let buffer = '';
  tunnel.stderr.setEncoding('utf8');
  tunnel.stderr.on('data', chunk => {
    buffer = (buffer + chunk).slice(-8192);
    const match = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i);
    if (match) {
      try { fs.writeFileSync(addressFile, `${match[0]}\n`); }
      catch (error) { report(`Address update failed: ${error.message}`); }
    }
  });
  tunnel.on('error', error => report(`Tunnel error: ${error.message}`));
  tunnel.on('close', code => {
    clearAddress();
    tunnel = null;
    if (!stopping) {
      report(`Tunnel stopped (${code}); retrying in 10 seconds`);
      retry = setTimeout(startTunnel, 10000);
    }
  });
}

app.server.on('error', error => {
  report(`Dashboard error: ${error.message}`);
  process.exitCode = 1;
});
app.start().then(() => {
  started = true;
  clearAddress();
  report('Dashboard listening on 127.0.0.1:8790');
  startTunnel();
}).catch(error => {
  report(`Dashboard startup failed: ${error.message}`);
  process.exitCode = 1;
  log.end();
});

function stop() {
  if (stopping) return;
  stopping = true;
  clearTimeout(retry);
  if (tunnel) tunnel.kill();
  if (started) clearAddress();
  const finished = () => log.end();
  if (started) app.stop().then(finished, finished);
  else finished();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
