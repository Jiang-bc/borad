'use strict';
// Only usage.jsonl contributes token counts; trace records can represent the same request.
// Expose the recorded in/out counters and keep cache counters separate, without guessing
// provider-specific billing semantics or adding reasoning/cache subsets a second time.
const {defaultCatalog,estimateCost}=require('./pricing.cjs');
const tokenFields=['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens'];
const token=v=>Number.isSafeInteger(v)&&v>=0?v:null;
function normalizeUsage(record){
 const inputTokens=token(record.in),outputTokens=token(record.out);
 return {inputTokens,outputTokens,cacheReadTokens:token(record.cache_read),cacheWriteTokens:token(record.cache_write),totalTokens:inputTokens===null||outputTokens===null?null:token(inputTokens+outputTokens)};
}
function summarize(rows){
 const result={requests:rows.length,inputTokens:null,outputTokens:null,cacheReadTokens:null,cacheWriteTokens:null,totalTokens:null,missingUsageRequests:0,estimatedCostUsd:null,pricedRequests:0,unpricedRequests:0};
 let estimatedCostUsd=0;
 const overflow=new Set();
 for(const row of rows){
  if(row.estimatedCostUsd!==null){result.pricedRequests++;estimatedCostUsd+=row.estimatedCostUsd;}else result.unpricedRequests++;
  if(row.inputTokens==null||row.outputTokens==null)result.missingUsageRequests++;
  for(const field of tokenFields){
   const value=token(row[field]);if(value===null||overflow.has(field))continue;
   const sum=(result[field]??0)+value;
   result[field]=token(sum);if(result[field]===null)overflow.add(field);
  }
 }
 // 已知输入/输出均计入累计；缺失的另一侧不伪造完整读数，由 missingUsageRequests 提示。
 if(result.inputTokens!==null||result.outputTokens!==null){
  result.totalTokens=overflow.has('inputTokens')||overflow.has('outputTokens')?null:token((result.inputTokens??0)+(result.outputTokens??0));
 }
 result.estimatedCostUsd=(!rows.length||result.pricedRequests>0)&&Number.isFinite(estimatedCostUsd)?estimatedCostUsd:null;
 result.pricingNote=`标准 API 参考价等价估算，非实际扣费；已定价 ${result.pricedRequests}/${rows.length} 条，未定价 ${result.unpricedRequests} 条。`+(result.unpricedRequests?'总额仅包含已定价记录，未知成本未计为零。':'');
 return result;
}
function queryTokens(history,params,now=new Date(),priceCatalog=defaultCatalog){
 const range=params.get('range')||'today';
 if(!['today','7d'].includes(range))throw new RangeError('range must be today or 7d');
 const end=new Date(now),dayMs=24*60*60*1000,offsetMs=8*60*60*1000;
 if(!Number.isFinite(end.getTime()))throw new RangeError('invalid statistics time');
 const midnight=Math.floor((end.getTime()+offsetMs)/dayMs)*dayMs-offsetMs;
 const start=new Date(midnight-(range==='7d'?6*dayMs:0));
 const from=start.toISOString(),to=end.toISOString();
 const window=history.filter(row=>{
  const time=Date.parse(row.time);
  return (row.source==='history'||row.source==='history+trace')&&Number.isFinite(time)&&time>=start.getTime()&&time<=end.getTime();
 });
 const providers=[...new Set(window.map(row=>row.provider).filter(Boolean))].sort();
 const provider=params.get('provider')||'';
 const snapshot=priceCatalog.getSnapshot();
 const filtered=window.filter(row=>!provider||row.provider===provider).map(row=>({...row,...estimateCost(row,snapshot)}));
 const summary=summarize(filtered);
 const size=Math.max(10,Math.min(50,Number.parseInt(params.get('size'),10)||20));
 const pages=Math.max(1,Math.ceil(filtered.length/size)),page=Math.max(1,Math.min(pages,Number.parseInt(params.get('page'),10)||1));
 filtered.sort((a,b)=>Date.parse(b.time)-Date.parse(a.time)||String(b.id).localeCompare(String(a.id)));
 // Whitelist every response field, including when callers pass enriched history rows.
 const rows=filtered.slice((page-1)*size,page*size).map(row=>({
  id:row.id,time:row.time,requestedModel:row.requestedModel,sentModel:row.sentModel,servedModel:row.servedModel,
  provider:row.provider,account:row.account,status:row.status,
  inputTokens:token(row.inputTokens),outputTokens:token(row.outputTokens),cacheReadTokens:token(row.cacheReadTokens),cacheWriteTokens:token(row.cacheWriteTokens),totalTokens:token(row.totalTokens),
  estimatedCostUsd:row.estimatedCostUsd,priceModel:row.priceModel,priceSource:row.priceSource,unitPrices:row.unitPrices,
  pricingStatus:row.pricingStatus,pricingMatch:row.pricingMatch,pricingContextTokens:row.pricingContextTokens,pricingTierThreshold:row.pricingTierThreshold,missingPricingFields:row.missingPricingFields,pricingNote:row.pricingNote
 }));
 return {range,timeZone:'Asia/Shanghai',from,to,providers,summary,rows,total:filtered.length,page,pages,size};
}
module.exports={normalizeUsage,queryTokens};
