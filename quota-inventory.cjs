'use strict';
const { createHash } = require('node:crypto');
const validId = value => typeof value === 'string' && /^[a-z0-9_-]{1,64}$/i.test(value);
const identity = (provider, user) => createHash('sha256').update(JSON.stringify([provider, 'account', user])).digest('hex').slice(0, 24);

// accounts 来自官方 `magpie accounts --json`，包含自动发现的登录，不能用
// providers.json 的目录成员代替。null 表示读取失败，此时只信任明确的 off。
function buildInventory(config, accounts) {
  if (!Array.isArray(config?.providers) || config.providers.some(p => !p || !validId(p.id))) throw new Error('Invalid providers inventory');
  if (accounts !== null && (!Array.isArray(accounts) || accounts.some(a => !a || !validId(a.agent) || typeof a.user !== 'string'))) throw new Error('Invalid accounts inventory');
  const providers = new Map(config.providers.map(p => [p.id.toLowerCase(), p]));
  const users = new Map();
  for (const a of accounts || []) {
    if (a.on === false) continue;
    const provider = a.agent.toLowerCase();
    if (!users.has(provider)) users.set(provider, new Set());
    users.get(provider).add(a.user);
  }
  const keyed = p => !!(typeof p?.key === 'string' && p.key.trim()) ||
    Array.isArray(p?.keys) && p.keys.some(k => k && !k.off && typeof k.key === 'string' && k.key.trim());
  function has(provider) {
    const p = providers.get(provider);
    if (p?.off) return false;
    return accounts === null || keyed(p) || !!users.get(provider)?.size;
  }
  return {
    has,
    allows(card) {
      if (!has(card.provider)) return false;
      if (accounts === null || keyed(providers.get(card.provider)) && card.kind !== 'subscription') return true;
      // 不带账号的错误是供应商级错误，不能因此删除仍有效的账号旧读数。
      if (!card.user) return true;
      const allowed = users.get(card.provider);
      return !!allowed && [...allowed].some(user => user === card.user || identity(card.provider, user) === card.id);
    },
  };
}
module.exports = { buildInventory };
