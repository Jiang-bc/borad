'use strict';
const fs = require('node:fs');
const path = require('node:path');

const appId = 'com.borad.desktop';
const preferenceKeys = ['startup', 'startupPath', 'autoShare', 'background'];

function createDesktopSettings({ directory, loginOptions, getLogin, setLogin }) {
  const file = path.join(directory, 'borad-settings.json');
  let preferences = {};
  try { preferences = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch {}

  function save(update) {
    const next = Object.fromEntries(Object.entries({ ...preferences, ...update }).filter(([key]) => preferenceKeys.includes(key)));
    const temporary = `${file}.tmp`;
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 });
    fs.renameSync(temporary, file);
    preferences = next;
  }

  if (Object.keys(preferences).some(key => !preferenceKeys.includes(key))) save({});

  function isStartupEnabled() {
    const login = getLogin(loginOptions);
    const registration = login.launchItems?.find(item => item.name === appId && item.scope !== 'machine');
    return login.openAtLogin && registration?.enabled !== false;
  }

  function registerStartup(openAtLogin) {
    setLogin({ ...loginOptions, name: appId, openAtLogin, enabled: openAtLogin });
    if (isStartupEnabled() !== openAtLogin)
      throw new Error('无法更新开机启动设置，请检查 Windows 登录项权限。');
  }

  function restoreStartup() {
    if (preferences.startup === true && preferences.startupPath !== loginOptions.path) {
      if (!getLogin(loginOptions).openAtLogin) registerStartup(true);
      save({ startupPath: loginOptions.path });
    } else if (typeof preferences.startup !== 'boolean' && isStartupEnabled()) {
      save({ startup: true, startupPath: loginOptions.path });
    }
  }

  return {
    restoreStartup,
    get startup() { return isStartupEnabled(); },
    setStartup(enabled) {
      registerStartup(enabled === true);
      save({ startup: enabled === true, startupPath: loginOptions.path });
    },
    get autoShare() { return preferences.autoShare === true; },
    setAutoShare(enabled) { save({ autoShare: enabled === true }); },
    get background() { return preferences.background === true; },
    setBackground(enabled) { save({ background: enabled === true }); },
  };
}

module.exports = { appId, createDesktopSettings };
