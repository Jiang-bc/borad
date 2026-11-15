'use strict';
const fs = require('node:fs');
const path = require('node:path');

const appId = 'com.borad.desktop';
const pushChannels = ['wechat', 'qq'];

function createDesktopSettings({ directory, loginOptions, getLogin, setLogin, secrets }) {
  const file = path.join(directory, 'borad-settings.json');
  let preferences = {};
  try { preferences = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch {}

  function save(update) {
    const next = { ...preferences, ...update };
    const temporary = `${file}.tmp`;
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 });
    fs.renameSync(temporary, file);
    preferences = next;
  }

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

  const channels = () => pushChannels.filter(channel => Array.isArray(preferences.pushChannels) && preferences.pushChannels.includes(channel));

  return {
    restoreStartup,
    get startup() { return isStartupEnabled(); },
    setStartup(enabled) {
      registerStartup(enabled === true);
      save({ startup: enabled === true, startupPath: loginOptions.path });
    },
    get autoShare() { return preferences.autoShare === true; },
    setAutoShare(enabled) { save({ autoShare: enabled === true }); },
    get pushState() {
      const bound = typeof preferences.pushSecret === 'string' && channels().length > 0;
      return { bound, channels: channels(), automatic: bound && preferences.autoPush === true };
    },
    configurePush({ token, channels: selected, automatic }) {
      if (!Array.isArray(selected) || !selected.length || selected.some(channel => !pushChannels.includes(channel)))
        throw new Error('请至少选择一个接收渠道。');
      if (typeof token !== 'string' || token.length > 128 || (token && !/^[a-zA-Z0-9_-]{16,128}$/.test(token)))
        throw new Error('请输入有效的 PushPlus Token。');
      if (!token && !preferences.pushSecret) throw new Error('请先填写 PushPlus Token。');
      let pushSecret = preferences.pushSecret;
      if (token) {
        if (!secrets.isEncryptionAvailable()) throw new Error('Windows 无法安全保存推送凭据。');
        pushSecret = secrets.encryptString(token).toString('base64');
      }
      save({ pushSecret, pushChannels: [...new Set(selected)], autoPush: automatic === true });
    },
    clearPush() { save({ pushSecret: undefined, pushChannels: [], autoPush: false }); },
    pushCredentials() {
      if (!this.pushState.bound) throw new Error('请先配置微信或 QQ 推送。');
      try {
        return { channels: channels(), token: secrets.decryptString(Buffer.from(preferences.pushSecret, 'base64')) };
      } catch { throw new Error('无法读取推送凭据，请重新填写 PushPlus Token。'); }
    },
  };
}

module.exports = { appId, createDesktopSettings };
