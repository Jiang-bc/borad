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

test('push settings persist without storing or reporting the plaintext token', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'borad-push-settings-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const options = {
    directory,
    secrets: {
      isEncryptionAvailable: () => true,
      encryptString: text => Buffer.from(text).reverse(),
      decryptString: encrypted => Buffer.from(encrypted).reverse().toString(),
    },
  };
  const settings = createDesktopSettings(options);
  const token = 'example-test-token';
  settings.configurePush({ token, channels: ['qq'], automatic: true });
  const reopened = createDesktopSettings(options);
  assert.deepEqual(reopened.pushState, { bound: true, channels: ['qq'], automatic: true });
  assert.deepEqual(reopened.pushCredentials(), { token, channels: ['qq'] });
  assert.ok(!fs.readFileSync(path.join(directory, 'borad-settings.json'), 'utf8').includes(token));
  assert.ok(!JSON.stringify(reopened.pushState).includes(token));
  assert.throws(() => reopened.configurePush({ token: '', channels: ['other'], automatic: true }));
  reopened.clearPush();
  assert.equal(createDesktopSettings(options).pushState.automatic, false);
});
