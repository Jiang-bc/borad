const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.join(__dirname, '..');
const env = { ...process.env };
env.ELECTRON_MIRROR ||= 'https://cdn.npmmirror.com/binaries/electron/';
env.ELECTRON_BUILDER_BINARIES_MIRROR ||= 'https://npmmirror.com/mirrors/electron-builder-binaries/';
const local = path.join(root, 'dist', 'electron');
try {
  if (!env.BORAD_ELECTRON_DIST && fs.readFileSync(path.join(local, 'version'), 'utf8').trim().replace(/^v/, '') === require('electron/package.json').version) env.BORAD_ELECTRON_DIST = local;
} catch {}
const child = spawn(process.execPath, [require.resolve('electron-builder/out/cli/cli.js'), '--win', 'nsis', 'zip', '--x64', '--config', path.join(root, 'electron-builder.cjs')], { cwd: root, env, stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
