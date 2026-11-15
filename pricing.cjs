'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const MILLION=1e6;
const counters={input:'inputTokens',output:'outputTokens',cacheRead:'cacheReadTokens',cacheWrite:'cacheWriteTokens'};
const catalogFields={input:'input',output:'output',cacheRead:'cache_read',cacheWrite:'cache_write'};
const manufacturers=new Set(['openai','anthropic','google','deepseek','moonshot','moonshotai','moonshotai-cn','zai','zhipuai','tencent-tokenhub','alibaba','alibaba-cn','mistral','mistralai','xai','x-ai','cohere','meta','nvidia','stepfun','xiaomi','minimax','minimax-cn','minimax-global','longcat','ai21','perplexity']);
const namespaces=new Set(['openai','anthropic','google','deepseek','moonshot','moonshotai','zai','zhipuai','tencent','qwen','alibaba','mistral','mistralai','xai','x-ai','cohere','meta','meta-llama','nvidia','stepfun','xiaomi','minimax','ai21','perplexity']);
const subscriptionMakers=new Set(['antigravity','workbuddy','workbuddy-ai','qwenwork','kiro','kilo-auto','opencode-go']);
const nonnegative=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
const count=v=>Number.isSafeInteger(v)&&v>=0?v:null;
const compare=(a,b)=>a<b?-1:a>b?1:0;
function safeId(value){
 if(typeof value!=='string')return null;
 const id=value.trim().toLowerCase();
 return /^[a-z0-9][a-z0-9._:/+-]{0,199}$/.test(id)&&!/(?:sk-|bearer)/i.test(id)?id:null;
}
function ambiguous(value){
 return typeof value==='string'&&(/(?:^|[/:_-])(?:auto|max-model|qoduck|qfmodel|dfmodel)(?:$|[/:_-])/i.test(value)||/^(?:free|pro|高级)$/i.test(value));
}
function modelKey(value){
 const id=safeId(value);if(!id)return null;
 const slash=id.indexOf('/');
 return slash>0&&namespaces.has(id.slice(0,slash))?id.slice(slash+1):id;
}
function unitPrices(cost){
 return Object.fromEntries(Object.entries(catalogFields).map(([key,field])=>[key,nonnegative(cost?.[field])]));
}
function contextTiers(cost){
 // Precise catalog tiers take precedence over the legacy, misleadingly named 200k field.
 const tiers=(Array.isArray(cost.tiers)?cost.tiers:[])
  .filter(t=>t?.tier?.type==='context'&&count(t.tier.size)!==null)
  .map(t=>({threshold:t.tier.size,prices:unitPrices(t)}))
  .sort((a,b)=>a.threshold-b.threshold);
 if(!tiers.length&&cost.context_over_200k&&typeof cost.context_over_200k==='object')tiers.push({threshold:200000,prices:unitPrices(cost.context_over_200k)});
 return tiers;
}
function buildPriceIndex(catalog){
 const byModel=new Map();
 if(!catalog||typeof catalog!=='object'||Array.isArray(catalog))return {byModel,available:false};
 for(const [rawMaker,provider] of Object.entries(catalog)){
  const maker=safeId(rawMaker);
  if(!maker||maker.includes('/')||subscriptionMakers.has(maker)||/(?:^|[-_])(?:plan|subscription|copilot|codex)(?:$|[-_])/.test(maker))continue;
  if(!provider?.models||typeof provider.models!=='object')continue;
  for(const [rawModel,model] of Object.entries(provider.models)){
   const id=safeId(rawModel),key=modelKey(rawModel),cost=model?.cost;
   if(!id||!key||ambiguous(id)||!cost||typeof cost!=='object')continue;
   const prices=unitPrices(cost);
   // Free/subscription entries are not API reference prices. Resolve an exact paid counterpart instead.
   if(!Object.values(prices).some(v=>v!==null&&v>0))continue;
   const entry={id,maker,prices,tiers:contextTiers(cost),source:`models.json:${maker}/${id}`,rank:manufacturers.has(maker)?0:maker==='openrouter'?1:2};
   if(!byModel.has(key))byModel.set(key,[]);
   byModel.get(key).push(entry);
  }
 }
 for(const entries of byModel.values())entries.sort((a,b)=>a.rank-b.rank||compare(a.maker,b.maker)||compare(a.id,b.id));
 return {byModel,available:true};
}
class PriceCatalog {
 constructor({filename=path.join(process.env.USERPROFILE||os.homedir(),'.cache','magpie','models.json'),ttlMs=30000,now=Date.now,io=fs}={}){
  this.filename=filename;this.ttlMs=ttlMs;this.now=now;this.io=io;this.nextCheck=-Infinity;this.stamp=null;this.snapshot=buildPriceIndex(null);
 }
 getSnapshot(){
  const now=this.now();if(now<this.nextCheck)return this.snapshot;
  this.nextCheck=now+this.ttlMs;
  try{
   const stat=this.io.statSync(this.filename),stamp=`${stat.ino}:${stat.mtimeMs}:${stat.size}`;
   if(stat.size>64*1024*1024)throw new Error('catalog-too-large');
   if(stamp!==this.stamp){
    this.snapshot=buildPriceIndex(JSON.parse(this.io.readFileSync(this.filename,'utf8')));
    this.stamp=stamp;
   }
  }catch{
   // Fail closed, without exposing file paths, raw catalog data or filesystem error messages.
   this.snapshot=buildPriceIndex(null);this.stamp=null;
  }
  return this.snapshot;
 }
}
const defaultCatalog=new PriceCatalog();
function lookup(snapshot,value){
 if(ambiguous(value))return null;
 const key=modelKey(value);if(!key)return null;
 const exact=snapshot.byModel.get(key)?.[0];
 if(exact)return {entry:exact,freeCounterpart:false};
 // Remove ONLY a terminal free marker. In particular, never strip -preview or model versions.
 const paidKey=key.replace(/(?::free|-free|free)$/,'');
 if(paidKey&&paidKey!==key&&!ambiguous(paidKey)){
  const paid=snapshot.byModel.get(paidKey)?.[0];
  if(paid)return {entry:paid,freeCounterpart:true};
 }
 return null;
}
function estimateCost(row,snapshot){
 const result={estimatedCostUsd:null,priceModel:null,priceSource:null,unitPrices:null,pricingStatus:'unpriced',pricingMatch:null,pricingContextTokens:null,pricingTierThreshold:null,missingPricingFields:[],pricingNote:''};
 let match=null;
 // An explicitly ambiguous served route is not evidence of an actual model.
 if(!ambiguous(row.servedModel))for(const field of ['servedModel','sentModel']){
  match=lookup(snapshot,row[field]);
  if(match){result.pricingMatch=field;break;}
 }
 const basis='标准 API 参考价等价估算，非实际扣费。';
 if(!match){result.pricingNote=basis+(snapshot.available?'无法确认同型号正价 API 报价，未定价。':'公开价格目录不可用，未定价。');return result;}
 const {entry,freeCounterpart}=match;
 result.priceModel=entry.id;result.priceSource=entry.source;
 result.unitPrices={...entry.prices};
 for(const field of Object.values(counters))if(count(row[field])===null)result.missingPricingFields.push(field);
 const contextFields=['inputTokens','cacheReadTokens','cacheWriteTokens'];
 if(contextFields.every(f=>count(row[f])!==null)){
  result.pricingContextTokens=count(contextFields.reduce((sum,f)=>sum+row[f],0));
  if(result.pricingContextTokens===null)result.missingPricingFields.push('pricingContextTokens');
 }
 if(result.pricingContextTokens!==null)for(const tier of entry.tiers){
  if(result.pricingContextTokens>tier.threshold){result.unitPrices={...tier.prices};result.pricingTierThreshold=tier.threshold;}
 }
 for(const [unit,field] of Object.entries(counters))if(count(row[field])!==null&&row[field]>0&&result.unitPrices[unit]===null)result.missingPricingFields.push(`unitPrices.${unit}`);
 const details=`报价来源 ${entry.source}；按${result.pricingMatch==='servedModel'?'实际返回型号':'发送型号'}匹配。`+(freeCounterpart?'free 型号采用去除 free 后缀后同型号的付费 API 参考价。':'')+(result.pricingTierThreshold!==null?`输入与缓存上下文严格超过 ${result.pricingTierThreshold}，整条请求使用对应阶梯费率。`:'');
 if(result.missingPricingFields.length){result.pricingNote=basis+details+'计数或使用类别的费率缺失，无法完整估算。';return result;}
 // usage.jsonl in/out are recorded separately from cache counters. Reasoning is already in out.
 const cost=Object.entries(counters).reduce((sum,[unit,field])=>sum+(row[field]===0?0:row[field]*result.unitPrices[unit]/MILLION),0);
 if(!Number.isFinite(cost)){result.pricingNote=basis+details+'计算结果超出可表示范围，未定价。';return result;}
 result.estimatedCostUsd=cost;result.pricingStatus='priced';result.pricingNote=basis+details;
 return result;
}
module.exports={buildPriceIndex,PriceCatalog,defaultCatalog,estimateCost};
