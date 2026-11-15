'use strict';
// 只变换看板的输出；输入是完整的账号快照，不写回 Magpie。
const { createHash } = require('node:crypto');
const EXCLUDED_PROVIDERS = new Set(['workbuddy-ai']);
const PROVIDER_NAMES = {
  codex: 'Codex', workbuddy: 'WorkBuddy', 'qoder-cn': 'Qoder CN',
  'trae-cn': 'Trae CN', antigravity: 'Antigravity', qwenwork: 'QwenWork',
  'intern-inkstone': '书生·墨点', cline: 'Cline', zcode: 'ZCode',
};
const finite = n => typeof n === 'number' && Number.isFinite(n);
const keyText = s => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
const opaqueId = parts => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
const validTime = s => typeof s === 'string' && Number.isFinite(Date.parse(s));
const sum = values => values.reduce((a, b) => a + b, 0);
const clamp = n => Math.max(0, Math.min(100, n));
function timeRange(values) {
  const times = values.filter(validTime).sort((a, b) => Date.parse(a) - Date.parse(b));
  return { oldest: times[0] || null, latest: times.at(-1) || null, unknownCount: values.length - times.length };
}
function normalizeUnit(value) {
  const u = String(value || '').trim().replace(/\s+/g, ' ');
  const currencies = { '$': 'USD', usd: 'USD', '¥': 'CNY', '￥': 'CNY', cny: 'CNY', rmb: 'CNY', '€': 'EUR', eur: 'EUR', '£': 'GBP', gbp: 'GBP' };
  return currencies[u.toLowerCase()] || (/^credits?$/i.test(u) ? 'credits' : u);
}

// amount 是实际已用量；used/remaining 是百分比。0 也是有效值，不能用 truthiness 判断。
function measureWindow(w) {
  if (!w || w.text) return { mode: 'text', remaining: null, remainingAmount: null };
  if (finite(w.limit) && w.limit > 0 && finite(w.amount) && w.amount >= 0) {
    const left = Math.max(0, w.limit - w.amount);
    return { mode: 'quantity', remaining: clamp(100 * left / w.limit), remainingAmount: left, amount: w.amount, limit: w.limit, inferred: false };
  }
  let percent = null;
  if (finite(w.remaining) && w.remaining >= 0 && w.remaining <= 100) percent = w.remaining;
  else if (finite(w.used) && w.used >= 0) percent = clamp(100 - w.used);
  if (finite(w.limit) && w.limit > 0) {
    return { mode: 'quantity', remaining: percent, remainingAmount: percent === null ? null : w.limit * percent / 100,
      amount: percent === null ? null : w.limit * (100 - percent) / 100, limit: w.limit, inferred: percent !== null };
  }
  // 0/0 不代表还剩 100%，但显式 remaining/used 仍能描述百分比。
  return { mode: 'percentage', remaining: percent, remainingAmount: null };
}

function parseBalance(value, explicitUnit) {
  if (finite(value)) return { amount: value, unit: normalizeUnit(explicitUnit) };
  if (typeof value !== 'string') return null;
  // 只消费开头的总余额，Qwen 括号中的 monthly/long-term 是分项说明。
  const m = value.match(/^\s*([$¥￥€£]|[A-Za-z]{3}\s+)?\s*(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?![\d,.])\s*([^\s()（）·]+)?/u);
  if (!m) return null;
  const prefix = (m[1] || '').trim();
  if (prefix && !/^[$¥￥€£]$|^(USD|CNY|RMB|EUR|GBP|CAD|AUD|JPY|HKD)$/i.test(prefix)) return null;
  const unit = normalizeUnit(prefix || explicitUnit || m[3]);
  const amount = Number(m[2].replaceAll(',', ''));
  return Number.isFinite(amount) ? { amount, unit } : null;
}
function balanceDisplay(amount, unit) {
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }).format(amount)}${unit ? ' ' + unit : ''}`;
}
function balanceNote(value) {
  if (typeof value !== 'string') return '';
  const parsed = parseBalance(value);
  if (!parsed) return '';
  const match = value.match(/^\s*(?:[$¥￥€£]|[A-Za-z]{3}\s+)?\s*-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?![\d,.])\s*(?:[^\s()（）·]+)?/u);
  return match ? value.slice(match[0].length).trim() : '';
}
function readingFingerprint(w) {
  return JSON.stringify(['used', 'remaining', 'resetsAt', 'amount', 'limit', 'text', 'display'].map(key => w[key] === undefined ? null : w[key]).concat(normalizeUnit(w.unit)));
}
function accountWindows(c) {
  const windows = c.windows || [];
  const argon = windows.filter(w => c.provider === 'antigravity' && keyText(w.pool) === 'gemini 4 argon'
    && /^gemini 4 argon(?:\s*\((?:low|medium|high|max)\)|\s*·\s*7 days)?$/i.test(String(w.name || '').trim()));
  const shared = argon.length > 0 && argon.every(w => !w.text && measureWindow(w).remaining !== null
    && readingFingerprint(w) === readingFingerprint(argon[0]));
  const rows = windows.filter(w => !shared || !argon.includes(w)).map(w => ({ w, sharedViewCount: 1 }));
  if (shared) rows.push({ w: { ...argon[0], name: argon[0].pool,
    label: `共享池视图：${argon.map(w => w.name).join('、')}` }, sharedPool: true, sharedViewCount: argon.length });
  const groups = new Map();
  for (const row of rows) {
    const key = JSON.stringify([keyText(row.w.pool), keyText(row.w.name), normalizeUnit(row.w.unit)]);
    if (!groups.has(key)) groups.set(key, new Map());
    groups.get(key).set(readingFingerprint(row.w), row);
  }
  return [...groups].flatMap(([key, readings]) => [...readings.values()].map((row, index) => ({ ...row,
    semanticKey: readings.size > 1 ? JSON.stringify([key, 'ambiguous', c.id, index]) : key })));
}

function deduplicateAccounts(cards) {
  const accounts = new Map();
  for (const [index, input] of cards.entries()) {
    if (!input || typeof input.provider !== 'string') continue;
    const c = { ...input, provider: keyText(input.provider) };
    // sanitizeCard 在掩码前生成 id；缺失身份时每条独立，绝不以掩码 user 去重。
    const id = c.id ?? opaqueId(['unidentified', c.provider, index]);
    c.id = id;
    const key = JSON.stringify([c.provider, id]);
    const old = accounts.get(key);
    if (!old || (validTime(c.readAt) ? Date.parse(c.readAt) : -Infinity) >= (validTime(old.readAt) ? Date.parse(old.readAt) : -Infinity)) accounts.set(key, c);
  }
  return [...accounts.values()];
}

function aggregateWindows(accounts) {
  const semantic = new Map();
  for (const c of accounts) {
    for (const { w, sharedViewCount, sharedPool, semanticKey: key } of accountWindows(c)) {
      if (!semantic.has(key)) semantic.set(key, []);
      // 查询失败且没有可回退快照时，供应商的占位 0 不是有效读数。
      const m = c.error && !c.retained && !w.text
        ? { mode: 'unknown', remaining: null, remainingAmount: null } : measureWindow(w);
      semantic.get(key).push({ c, w, m, sharedViewCount, sharedPool });
    }
  }
  const result = [];
  for (const [semanticKey, rows] of semantic) {
    const quantities = rows.some(r => r.m.mode === 'quantity');
    const buckets = new Map();
    for (const row of rows) {
      const { c, m } = row;
      const planKey = keyText(c.plan) || `unknown:${c.id}`;
      const mode = m.mode === 'text' ? 'text' : m.mode === 'quantity' || (m.remaining === null && quantities) ? 'quantity' : 'percentage';
      const key = mode === 'percentage' ? `${mode}:${planKey}` : mode;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(row);
    }
    for (const [bucketKey, members] of buckets) {
      const first = members[0];
      const mode = bucketKey.split(':')[0];
      const w = { id: opaqueId(['window', semanticKey, bucketKey]), name: first.w.name || '额度', unit: normalizeUnit(first.w.unit) };
      if (first.w.pool) w.pool = first.w.pool;
      if (members.some(r => r.sharedPool)) {
        w.sharedPool = true;
        w.sharedViewCount = sum(members.map(r => r.sharedViewCount));
        w.label = members.map(r => r.w.label).filter(Boolean).join('；');
      }
      if (mode === 'text') {
        w.text = true;
        w.display = [...new Set(members.map(r => r.w.display).filter(Boolean))].join('；');
        w.aggregation = 'text';
        result.push(w); continue;
      }
      const eligible = mode === 'percentage'
        ? accounts.filter(c => keyText(c.plan) ? keyText(c.plan) === keyText(first.c.plan) : c === first.c)
        : accounts;
      const memberIds = new Set(members.map(r => r.c.id));
      // 不把缺失窗口的账号当作 0，也不把已用尽账号从分母剔除。
      const missing = eligible.filter(c => !memberIds.has(c.id)).length;
      const known = members.filter(r => r.m.remaining !== null);
      const unknown = members.length - known.length + missing;
      Object.assign(w, {
        aggregation: mode === 'quantity' ? 'sum' : 'mean', sampleCount: known.length,
        accountCount: members.length, expectedAccountCount: eligible.length,
        unknownCount: unknown, missingAccountCount: missing, complete: unknown === 0,
        remaining: null, used: null, remainingAmount: null,
      });
      if (mode === 'quantity') {
        const measured = known.filter(r => r.m.mode === 'quantity');
        w.knownLimit = sum(measured.map(r => r.m.limit));
        w.knownRemainingAmount = sum(measured.map(r => r.m.remainingAmount));
        w.knownAmount = sum(measured.map(r => r.m.amount));
        w.inferredCount = measured.filter(r => r.m.inferred).length;
        w.label = `${w.label ? w.label + '；' : ''}${unknown ? '同单位汇总（部分额度未知）' : '同单位汇总'}`;
        if (!unknown && measured.length) {
          w.limit = w.knownLimit;
          w.amount = w.knownAmount;
          w.remainingAmount = w.knownRemainingAmount;
          w.remaining = clamp(100 * w.remainingAmount / w.limit);
        }
      } else {
        w.plan = first.c.plan || null;
        w.label = `${w.label ? w.label + '；' : ''}${w.plan || '套餐未知'} · 平均剩余（${known.length} 个账号）`;
        if (known.length) w.knownMeanRemaining = sum(known.map(r => r.m.remaining)) / known.length;
        if (!unknown && known.length) w.remaining = w.knownMeanRemaining;
        w.note = '仅有百分比，同套餐按账号算术平均；不能换算或相加为总额度。';
      }
      if (w.remaining !== null) w.used = 100 - w.remaining;
      if (w.label && (w.aggregation === 'sum' || w.aggregation === 'mean')) w.label += '；';
      if (buckets.size > 1) w.label += '此窗口分口径展示，不跨套餐或计量方式相加';
      const resets = timeRange(members.map(r => r.w.resetsAt));
      w.resetsAt = resets.oldest;
      w.resetsAtLatest = resets.latest;
      w.resetTimesDiffer = resets.oldest !== resets.latest;
      w.resetTimeUnknownCount = resets.unknownCount;
      result.push(w);
    }
  }
  return result;
}

function accountExhausted(c) {
  if (c.error) return false;
  const balancePresent = c.balance !== undefined && c.balance !== null;
  const balance = parseBalance(c.balance, c.balanceUnit || c.currency);
  if (balancePresent && (!balance || balance.amount > 0)) return false;
  const windows = (c.windows || []).filter(w => !w.text);
  if (windows.length) return windows.every(w => measureWindow(w).remaining === 0);
  return !!balance && balance.amount <= 0;
}

function aggregateByProvider(cards) {
  const groups = new Map();
  for (const c of deduplicateAccounts(Array.isArray(cards) ? cards.filter(c => c && typeof c.provider === 'string') : [])) {
    if (EXCLUDED_PROVIDERS.has(c.provider)) continue;
    if (!groups.has(c.provider)) groups.set(c.provider, []);
    groups.get(c.provider).push(c);
  }
  return [...groups].map(([provider, accounts]) => {
    const displayName = PROVIDER_NAMES[provider] || provider;
    const times = timeRange(accounts.map(c => c.readAt));
    const windows = aggregateWindows(accounts);
    const plans = [...new Set(accounts.map(c => c.plan).filter(Boolean))].sort();
    const balancesByUnit = new Map();
    let balanceUnknownCount = 0;
    const balanceNotes = [...new Set(accounts.filter(c => !c.error || c.retained).map(c => balanceNote(c.balance)).filter(Boolean))];
    for (const c of accounts) {
      const b = c.error && !c.retained ? null : parseBalance(c.balance, c.balanceUnit || c.currency);
      if (!b) { if (c.balance !== undefined && c.balance !== null || c.kind === 'balance') balanceUnknownCount++; continue; }
      const key = b.unit || `unknown:${c.id}`;
      if (!balancesByUnit.has(key)) balancesByUnit.set(key, { unit: b.unit, amount: 0, accountCount: 0 });
      const total = balancesByUnit.get(key);
      total.amount += b.amount; total.accountCount++;
    }
    const balances = [...balancesByUnit.values()].map(b => ({ ...b, display: balanceDisplay(b.amount, b.unit) }));
    const out = {
      id: `provider-${provider}`, provider, name: displayName, alias: displayName, user: '',
      aggregated: true, accountCount: accounts.length, mergedAccounts: accounts.length,
      kind: [...new Set(accounts.map(c => c.kind))].length === 1 ? accounts[0].kind : 'mixed',
      plans, plan: plans.length === 1 ? plans[0] : plans.length ? '多套餐' : '',
      windows, balances, balanceNotes, balanceUnknownCount,
      readAt: times.oldest, readAtLatest: times.latest, readAtUnknownCount: times.unknownCount,
      readAtNote: times.unknownCount ? `${times.unknownCount} 个账号采集时间未知；采集时间取其余账号中最旧的有效值` : '采集时间取组内最旧的有效值',
      isExhausted: accounts.every(accountExhausted),
      errorCount: accounts.filter(c => c.error).length,
      retained: accounts.some(c => c.retained),
      primaryWindowName: null,
    };
    // 兼容旧前端 balance 字段；多币种按文本分列，绝不产生跨单位总数。
    if (balances.length) out.balance = balances.map(b => b.display).join(' · ');
    if (balances.length === 1 && !balanceUnknownCount) {
      out.balanceAmount = balances[0].amount; out.balanceUnit = balances[0].unit;
    }
    if (out.errorCount) out.error = `${out.errorCount}/${accounts.length} 个账号查询异常；${[...new Set(accounts.map(c => c.error).filter(Boolean))].join('；')}`;
    if (accounts.some(c => c.last)) out.last = true;
    out.lastServedAt = timeRange(accounts.map(c => c.lastServedAt)).latest;
    const quotaWindows = windows.filter(w => !w.text);
    if (provider === 'workbuddy' && quotaWindows.some(w => keyText(w.name) === 'total credits')) out.primaryWindowName = 'Total credits';
    else if (quotaWindows.length === 1) out.primaryWindowName = quotaWindows[0].name;
    for (const w of windows) w.primary = !!out.primaryWindowName && keyText(w.name) === keyText(out.primaryWindowName);
    return out;
  });
}

module.exports = { aggregateByProvider, measureWindow, parseBalance, accountExhausted, deduplicateAccounts, EXCLUDED_PROVIDERS };
