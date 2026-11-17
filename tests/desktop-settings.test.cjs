'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDesktopSettings } = require('../desktop/settings.cjs');

test('startup choice survives a move and automatic sharing is an independent opt-in', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'borad-settings-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let registeredPath = null;
  let windowsEnabled = false;
  const settingsAt = executable => createDesktopSettings({
    directory,
    loginOptions: { path: executable, args: [] },
    getLogin: ({ path: candidate }) => ({ openAtLogin: registeredPath === candidate, launchItems: registeredPath === candidate ? [{ name: 'com.borad.desktop', enabled: windowsEnabled }] : [] }),
    setLogin: ({ path: candidate, openAtLogin }) => { registeredPath = openAtLogin ? candidate : null; windowsEnabled = openAtLogin; },
  });
  const original = settingsAt('C:\\Old\\Borad.exe');
  assert.equal(original.autoShare, false);
  original.setStartup(true);
  assert.equal(original.startup, true);
  assert.equal(settingsAt('C:\\Old\\Borad.exe').startup, true);
  original.setAutoShare(true);

  const moved = settingsAt('C:\\New\\Borad.exe');
  moved.restoreStartup();
  assert.equal(moved.startup, true);
  assert.equal(registeredPath, 'C:\\New\\Borad.exe');
  assert.equal(moved.autoShare, true);
  windowsEnabled = false;
  assert.equal(settingsAt('C:\\New\\Borad.exe').startup, false);
  moved.setStartup(false);
  moved.setAutoShare(false);
  const reopened = settingsAt('C:\\New\\Borad.exe');
  assert.equal(reopened.startup, false);
  assert.equal(reopened.autoShare, false);
});

test('obsolete preferences and saved push credentials are removed while current choices survive', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'borad-settings-migration-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'borad-settings.json');
  fs.writeFileSync(file, JSON.stringify({
    startup: true,
    startupPath: 'C:\\Borad\\Borad.exe',
    autoShare: true,
    background: true,
    pushSecret: 'obsolete-encrypted-token',
    pushChannels: ['qq'],
    autoPush: true,
  }));
  const settings = createDesktopSettings({ directory });
  assert.equal(settings.autoShare, true);
  assert.equal(settings.background, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {
    startup: true,
    startupPath: 'C:\\Borad\\Borad.exe',
    autoShare: true,
    background: true,
  });
  settings.setAutoShare(false);
  const reopened = createDesktopSettings({ directory });
  assert.equal(reopened.autoShare, false);
  assert.equal(reopened.background, true);
});

test('background mode is opt-in and persists across restarts', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'borad-background-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const options = { directory };
  const settings = createDesktopSettings(options);
  assert.equal(settings.background, false);
  settings.setBackground(true);
  const reopened = createDesktopSettings(options);
  assert.equal(reopened.background, true);
  reopened.setBackground(false);
  assert.equal(createDesktopSettings(options).background, false);
});
