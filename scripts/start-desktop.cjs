const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.join(__dirname, '..');
const local = process.env.BORAD_ELECTRON_DIST || path.join(root, 'dist', 'electron');
const executable = path.join(local, 'electron.exe');
const expected = require('electron/package.json').version;
let binary;
try {
  if (process.platform === 'win32' && fs.existsSync(executable) && fs.readFileSync(path.join(local, 'version'), 'utf8').trim().replace(/^v/, '') === expected) {
    binary = executable;
  } else {
    process.env.ELECTRON_MIRROR ||= 'https://cdn.npmmirror.com/binaries/electron/';
    binary = require('electron');
  }
} catch (error) {
  console.error(`Unable to prepare Electron: ${error.message}`);
  process.exit(1);
}
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(binary, [root], { stdio: 'inherit', env });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
