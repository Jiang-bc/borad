'use strict';
// Reused from magpie-phone: whitelist/masking, inventory, retention, single-flight,
// bounded provider refresh, timeout, unsupported-provider skip and circuit cooldown.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const sha256=s=>crypto.createHash('sha256').update(String(s),'utf8').digest();
function createQuotaService({fetchImpl=fetch,run,inventory,accounts,config={}}={}) {
const CFG = {
  sessionTtlMs: 30 * 24 * 3600 * 1000, // 会话有效期（滑动续期）
  maxSessions: 50,
  loginMaxFails: 5,                    // 单 IP 在窗口内允许的失败次数
  loginWindowMs: 15 * 60 * 1000,
  loginLockMs: 15 * 60 * 1000,
  globalMaxFails: 30,                  // 全局失败上限（隧道下所有请求都来自 127.0.0.1）
  refreshConcurrency: 2,               // 按供应商刷新的并发上限
  refreshProviderTimeoutMs: 45 * 1000,
  readTimeoutMs: 3 * 1000,
  cliReadTimeoutMs: 8 * 1000,
  staleReadMs: 3 * 1000,              // 只读同步当前清单与额度缓存，不主动查询供应商
  autoRefreshMs: 60 * 1000,
  circuitMaxFails: 2,                  // 连续失败 N 次后进入冷却
  circuitBaseCooldownMs: 15 * 60 * 1000,
  circuitMaxCooldownMs: 2 * 3600 * 1000,
};


Object.assign(CFG,config);
function magpieCandidates() {
  const list = [];
  if (process.env.LOCALAPPDATA) {
    const base = path.join(process.env.LOCALAPPDATA, 'Programs', 'magpie');
    list.push(path.join(base, 'magpie.com'), path.join(base, 'magpie.exe'));
  }
  list.push('magpie', 'magpie.exe'); // 交给 spawn 逐个尝试
  return list;
}
let magpieCmd = null;

function killTree(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    try {
      const killer = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      killer.on('error', () => { try { child.kill('SIGKILL'); } catch (_) { /* 已退出 */ } });
      killer.on('close', code => { if (code !== 0) { try { child.kill('SIGKILL'); } catch (_) {} } });
      return;
    } catch (_) { /* 落到 kill */ }
  }
  try { child.kill('SIGKILL'); } catch (_) { /* 已退出 */ }
}

// 运行一次 magpie 命令；ENOENT 时自动尝试下一个候选路径。
function runMagpie(args, timeoutMs) {
  return new Promise((resolve) => {
    const candidates = magpieCmd ? [magpieCmd] : magpieCandidates();
    (function attempt() {
      const cmd = candidates.shift();
      if (!cmd) return resolve({ ok: false, error: new Error('未找到 magpie 命令（尝试过 PATH 与 %LOCALAPPDATA%\\Programs\\magpie）') });
      let child;
      try {
        child = spawn(cmd, args, { windowsHide: true });
      } catch (e) {
        return attempt();
      }
      let stdout = '', stderr = '', done = false;
      const finish = (r) => { if (done) return; done = true; clearTimeout(timer); resolve(r); };
      const timer = setTimeout(() => { killTree(child); finish({ ok: false, error: new Error(`命令超时（${Math.round(timeoutMs / 1000)}s）`) }); }, timeoutMs);
      child.stdout.on('data', (c) => { stdout += c; });
      child.stderr.on('data', (c) => { stderr += c; if (stderr.length > 65536) stderr = stderr.slice(-65536); });
      child.on('error', (e) => {
        if (e.code === 'ENOENT' && !magpieCmd) return attempt(); // 换下一个候选
        clearTimeout(timer); finish({ ok: false, error: e });
      });
      child.on('close', (code) => {
        if (code === 0) { magpieCmd = cmd; return finish({ ok: true, stdout, stderr }); }
        finish({ ok: false, code, error: new Error(`magpie 退出码 ${code}：${stderr.trim().slice(0, 300) || '无输出'}`) });
      });
    })();
  });
}

/* ---------------- 数据清洗（掩码 + 字段白名单）---------------- */

const CARD_FIELDS = ['provider', 'name', 'alias', 'kind', 'plan', 'user', 'balance', 'balanceUnit', 'currency', 'primaryWindowName', 'readAt', 'until', 'renew', 'lastServedAt', 'last'];
const WIN_FIELDS = ['name', 'pool', 'used', 'remaining', 'resetsAt', 'display', 'amount', 'limit', 'unit', 'text', 'holdsWhy', 'runsOutAt', 'runsOut'];

function maskUser(u) {
  if (typeof u !== 'string' || !u) return u;
  const m = u.match(/^([^@]+)@([^@]+)$/);
  if (m) return (m[1].length <= 2 ? m[1] : m[1].slice(0, 2)) + '***@' + m[2];
  if (/^\d{6,}$/.test(u)) return u.slice(0, 3) + '****' + u.slice(-2);
  return u.length <= 3 ? u.slice(0, 1) + '**' : u.slice(0, 2) + '***' + u.slice(-2);
}

function publicError(error) {
  const msg = String(error && error.message || error || '');
  if (/超时|timeout|timed out/i.test(msg)) return '查询超时';
  if (/unsupported|unknown provider|unrecognized provider|not supported|does not support|only supports|cannot refresh|can only refresh|doesn't support|不支持/i.test(msg)) return '此供应商不支持手动刷新，仍可读取已有用量';
  if (/未找到|ENOENT/.test(msg)) return '未找到 Magpie CLI，请检查本机安装';
  if (/401|403|unauthori[sz]ed|expired|失效|登录/i.test(msg)) return '账号授权可能已失效，请在电脑 Magpie 中检查';
  if (/429|rate.?limit/i.test(msg)) return '供应商暂时限流，请稍后再试';
  return '查询未成功；请在电脑 Magpie 中检查';
}

function sanitizeCard(c) {
  if (!c || typeof c !== 'object' || typeof c.provider !== 'string' || !/^[a-z0-9_-]{1,64}$/i.test(c.provider)) return null;
  const out = {};
  const provider = c.provider.toLowerCase();
  // 在掩码前生成身份；源 id 优先，别名修改不影响已有 user 的身份。
  const sourceIdentity = typeof c.id === 'string' || typeof c.id === 'number' ? ['id', c.id]
    : ['account', c.user || c.alias || c.name || 'unknown'];
  out.id = sha256(JSON.stringify([provider, ...sourceIdentity])).toString('hex').slice(0, 24);
  for (const k of CARD_FIELDS) {
    const value = c[k];
    if (typeof value === 'string') out[k] = value.slice(0, 1024);
    else if (typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) out[k] = value;
  }
  out.provider = provider;
  if (typeof out.user === 'string') out.user = maskUser(out.user);
  for (const k of ['name', 'alias']) if (out[k]) out[k] = out[k].replace(/[^\s@]+@[^\s@]+/g, maskUser);
  if (c.error) out.error = publicError(c.error);
  out.windows = Array.isArray(c.windows) ? c.windows.map((w) => {
    const o = {};
    for (const k of WIN_FIELDS) {
      const value = w && w[k];
      if (typeof value === 'string') o[k] = value.slice(0, 1024);
      else if (typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) o[k] = value;
    }
    return o;
  }) : [];
  return out;
}

function parseQuotaJson(text) {
  const j = JSON.parse(text);
  const arr = Array.isArray(j) ? j : Array.isArray(j.data) ? j.data : null;
  if (!arr) throw new Error('magpie 输出不是预期的配额数组');
  return arr.map(sanitizeCard).filter(Boolean);
}

// API 聚合与账号快照分离；排除项绝不并入其他供应商。
const { aggregateByProvider, deduplicateAccounts, EXCLUDED_PROVIDERS } = require('./quota-aggregation.cjs');
const visibleProviders = cards => [...new Set(cards.map(c => c.provider).filter(p => p && !EXCLUDED_PROVIDERS.has(p)))];

/* ---------------- 快照与刷新引擎 ---------------- */

let snapshot = null;             // {cards, fetchedAt, fetchMs, fetchError, source}
let snapshotVersion = 0;
let readPromise = null;          // 全量读取单航班
const refreshState = { running: false, startedAt: null, finishedAt: null, ok: null, perProvider: {}, error: null };
let refreshPromise = null;
let lastRefreshAttempt = null;
const circuits = new Map();      // provider -> {fails, cooldownUntil}
const unsupportedProviders = new Set();
let lastReadAttempt = 0;

const { buildInventory } = require('./quota-inventory.cjs');
let currentAccounts = null;
let accountsReadAt = 0;
async function readCurrentAccounts() {
  if (currentAccounts !== null && Date.now() - accountsReadAt < CFG.staleReadMs) return currentAccounts;
  try {
    const result = await runMagpie(['accounts', '--json'], CFG.readTimeoutMs);
    if (!result.ok) return null;
    const accounts = JSON.parse(result.stdout.replace(/^﻿/, ''));
    buildInventory({ providers: [] }, accounts); // 完整验证后才允许用于删除判断。
    accountsReadAt = Date.now();
    return accounts;
  } catch (_) { return null; }
}
function readActiveProviders() {
  try {
    const file = path.join(process.env.USERPROFILE || process.env.HOME || '.', '.config', 'magpie', 'providers.json');
    return buildInventory(JSON.parse(fs.readFileSync(file, 'utf8')), currentAccounts);
  } catch (_) { return null; } // 配置不可读不能当作“全部已删除”。
}
function activeCards(cards) {
  const active = readActiveProviders();
  return active ? cards.filter(c => active.allows ? active.allows(c) : active.has(c.provider)) : cards;
}
function reconcileCards(previous, incoming) {
  const oldById = new Map(previous.map(c => [c.id, c]));
  const cards = [];
  for (const c of deduplicateAccounts(incoming)) {
    const old = oldById.get(c.id);
    if (c.error && !c.user) {
      const accounts = previous.filter(p => p.provider === c.provider);
      if (accounts.length) {
        cards.push(...accounts.map(account => ({ ...account, error: c.error, retained: true })));
        continue;
      }
    }
    const oldTime = Date.parse(old?.readAt), incomingTime = Date.parse(c.readAt);
    if (old && Number.isFinite(oldTime) && Number.isFinite(incomingTime) && incomingTime < oldTime) cards.push(old);
    else if (c.error && old) cards.push({ ...old, error: c.error, retained: true });
    else if (old && Number.isFinite(oldTime) && (!Number.isFinite(incomingTime) || incomingTime < oldTime
      || old.error && incomingTime === oldTime)) cards.push(old);
    else if (old?.error && !Number.isFinite(incomingTime)) cards.push(old);
    else cards.push(c);
  }
  // 成功清单提供当前成员关系；只有明确失败才保留旧数据。
  return activeCards(deduplicateAccounts(cards));
}

async function readAll(source) {
  const t0 = Date.now();
  lastReadAttempt = t0;
  currentAccounts = await readCurrentAccounts();
  let r;
  try {
    // 网关保留完整账号快照；CLI 在短暂连接异常时可能只返回余额账号。
    const response = await fetchImpl('http://127.0.0.1:3425/v1/magpie/quotas?kept=1', {
      signal: AbortSignal.timeout(CFG.readTimeoutMs), redirect: 'error'
    });
    if (!response.ok) throw new Error('gateway unavailable');
    r = { ok: true, stdout: await response.text() };
  } catch (_) {
    r = await runMagpie(['quota', '--json'], CFG.cliReadTimeoutMs);
  }
  if (!r.ok) {
    const msg = '全量读取失败：' + publicError(r.error);
    if (snapshot) return { ...snapshot, cards: activeCards(snapshot.cards), fetchError: msg };
    return { cards: [], fetchedAt: null, fetchMs: Date.now() - t0, fetchError: msg, source };
  }
  try {
    const incoming = parseQuotaJson(r.stdout);
    // 保持原始账号快照，聚合仍只发生在 API 边界。
    const cards = reconcileCards(snapshot && snapshot.cards || [], incoming);
    return { cards, fetchedAt: new Date().toISOString(), fetchMs: Date.now() - t0, fetchError: null, source };
  } catch (_) {
    const msg = '无法解析 Magpie 用量，已保留上次数据';
    if (snapshot) return { ...snapshot, cards: activeCards(snapshot.cards), fetchError: msg };
    return { cards: [], fetchedAt: null, fetchMs: Date.now() - t0, fetchError: msg, source };
  }
}

async function ensureRead() {
  if (snapshot) return snapshot; // 已有数据立即返回；失败重试放在后台，不阻塞页面。
  return readSnapshot('initial');
}

function readSnapshot(source) {
  if (!readPromise) {
    const version = snapshotVersion;
    readPromise = readAll(source).then(s => {
      if (snapshotVersion === version) snapshot = s;
      return snapshot;
    }).finally(() => { readPromise = null; });
  }
  return readPromise;
}

// 快照过旧时后台静默重读（只读 magpie 缓存，不触发供应商刷新）
function maybeBackgroundRead() {
  if (readPromise) return;
  if (!snapshot) return;
  if (Date.now() - lastReadAttempt < CFG.staleReadMs) return;
  readSnapshot('background').catch(() => {});
}

function circuitFail(p) {
  const c = circuits.get(p) || { fails: 0, cooldownUntil: 0 };
  c.fails += 1;
  if (c.fails >= CFG.circuitMaxFails) {
    const mult = Math.pow(2, c.fails - CFG.circuitMaxFails);
    const cd = Math.min(CFG.circuitBaseCooldownMs * mult, CFG.circuitMaxCooldownMs);
    c.cooldownUntil = Date.now() + cd;
  }
  circuits.set(p, c);
}
const circuitReset = (p) => circuits.delete(p);
const circuitOpen = (p) => { const c = circuits.get(p); return !!(c && c.cooldownUntil > Date.now()); };

async function mapLimit(items, limit, fn) {
  const ret = [];
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (i < items.length) {
      const idx = i++;
      ret[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return ret;
}

function firstCardError(cards) {
  for (const c of cards) if (c && c.error) return String(c.error);
  return '';
}

// 单航班刷新：进行中重复请求直接并入
function startRefresh({ automatic = false } = {}) {
  if (refreshState.running) return refreshPromise;
  if (automatic && lastRefreshAttempt !== null && Date.now() - lastRefreshAttempt < CFG.autoRefreshMs) return Promise.resolve();
  lastRefreshAttempt = Date.now();
  refreshState.running = true;
  refreshState.startedAt = new Date().toISOString();
  refreshState.finishedAt = null;
  refreshState.ok = null;
  refreshState.error = null;
  refreshState.perProvider = {};

  refreshPromise = (async () => {
    let finalError = null;
    try {
      // 每轮先重新读取当前账号清单，发现新增账号并移除已删账号。
      await readSnapshot('refresh');
      snapshot.cards = activeCards(snapshot.cards);
      const providers = visibleProviders(snapshot && snapshot.cards || []);
      const queue = [];
      for (const p of providers) {
        if (unsupportedProviders.has(p)) {
          refreshState.perProvider[p] = { status: 'unsupported', note: '此供应商不支持手动刷新，已跳过；仍读取已有用量' };
        } else if (circuitOpen(p)) {
          refreshState.perProvider[p] = { status: 'cooldown', note: '近期多次失败，已暂停刷新（稍后自动重试）', retryAt: new Date(circuits.get(p).cooldownUntil).toISOString() };
        } else {
          queue.push(p);
          refreshState.perProvider[p] = { status: 'pending' };
        }
      }
      await mapLimit(queue, CFG.refreshConcurrency, async (p) => {
        const t0 = Date.now();
        refreshState.perProvider[p] = { status: 'running' };
        let r;
        try { r = await runMagpie(['quota', 'refresh', p, '--json'], CFG.refreshProviderTimeoutMs); }
        catch (error) { r = { ok: false, error }; }
        let cards = null;
        if (r.ok) { try { cards = parseQuotaJson(r.stdout).filter(c => c.provider === p); if (!cards.length) cards = null; } catch (_) { cards = null; } }
        const rawError = r.error && r.error.message || r.stderr || '';
        if (!r.ok && /unsupported|unknown provider|unrecognized provider|not supported|does not support|only supports|cannot refresh|can only refresh|doesn't support|不支持/i.test(rawError)) {
          unsupportedProviders.add(p);
          refreshState.perProvider[p] = { status: 'unsupported', note: '此供应商不支持手动刷新，已跳过；仍读取已有用量' };
        } else if (r.ok && cards && cards.some((c) => c.error)) {
          circuitFail(p);
          refreshState.perProvider[p] = { status: 'error', ms: Date.now() - t0, note: firstCardError(cards) };
        } else if (r.ok && cards) {
          refreshState.perProvider[p] = { status: 'ok', ms: Date.now() - t0 };
        } else {
          circuitFail(p);
          refreshState.perProvider[p] = { status: 'error', ms: Date.now() - t0, note: publicError(r.error) };
        }
        if (cards !== null) {
          // 只发布刚完成的供应商，慢供应商继续查询；采集时间仍使用源数据。
          const previous = snapshot.cards.filter(c => c.provider === p);
          snapshot = { ...snapshot,
            cards: activeCards([...snapshot.cards.filter(c => c.provider !== p), ...reconcileCards(previous, cards)]),
            fetchedAt: new Date().toISOString(), source: 'refresh' };
          snapshotVersion++;
          if (refreshState.perProvider[p].status === 'ok') {
            if (snapshot.cards.some(c => c.provider === p && c.error)) {
              circuitFail(p);
              refreshState.perProvider[p] = { status: 'error', ms: Date.now() - t0, note: '源采集时间未更新，仍保留上次失败状态与数据' };
            } else circuitReset(p);
          }
        } else if (!unsupportedProviders.has(p)) {
          const error = publicError(r.error || r.stderr || 'invalid quota response');
          snapshot = { ...snapshot, cards: activeCards(snapshot.cards.map(c => c.provider === p
            ? { ...c, error, retained: true } : c)) };
          snapshotVersion++;
        }
      });
      // CLI 返回只是供应商片段；收尾必须对齐网关保留的完整缓存快照。
      if (readPromise) await readPromise;
      await readSnapshot('refresh-final');
      snapshotVersion++;
      if (snapshot.fetchError) finalError = snapshot.fetchError;
      else {
        const failed = Object.values(refreshState.perProvider).filter(s => s.status === 'error' || s.status === 'cooldown').length;
        if (failed) finalError = `${failed} 个供应商主动采集未成功；当前读数与源采集时间见各组`;
      }
    } catch (e) {
      finalError = publicError(e);
    } finally {
      refreshState.running = false;
      refreshState.finishedAt = new Date().toISOString();
      refreshState.ok = !finalError;
      refreshState.error = finalError;
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}


if(run)runMagpie=run;
if(inventory)readActiveProviders=inventory;
if(accounts)readCurrentAccounts=accounts;
return {
 async read({hiddenIds=[]}={}){
  await ensureRead();maybeBackgroundRead();
  const active=deduplicateAccounts(activeCards(snapshot.cards)).filter(card=>!EXCLUDED_PROVIDERS.has(card.provider));
  const hidden=new Set(Array.isArray(hiddenIds)?hiddenIds.filter(id=>typeof id==='string'&&/^[a-f0-9]{24}$/.test(id)).slice(0,500):[]);
  const accounts=active.map((card,index)=>({id:card.id,provider:card.provider,label:card.user||`账号 ${index+1}`}));
  const cards=aggregateByProvider(active.filter(card=>!hidden.has(card.id)));
  return {aggregationVersion:2,exhaustionPolicy:'frontend',excludedProviders:[...EXCLUDED_PROVIDERS],cards,accounts,
   syncIntervalMs:CFG.staleReadMs,autoRefreshIntervalMs:CFG.autoRefreshMs,
   nextAutoRefreshAt:lastRefreshAttempt===null?null:new Date(lastRefreshAttempt+CFG.autoRefreshMs).toISOString(),
   fetchedAt:snapshot.fetchedAt,fetchMs:snapshot.fetchMs,fetchError:snapshot.fetchError,
   source:snapshot.source,refreshing:refreshState.running,
   refresh:{startedAt:refreshState.startedAt,finishedAt:refreshState.finishedAt,ok:refreshState.ok,error:refreshState.error,perProvider:{...refreshState.perProvider}},
   providerCount:cards.length,serverTime:new Date().toISOString()};
 },
 refresh:startRefresh
};
}
module.exports={createQuotaService};
