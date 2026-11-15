'use strict';
const crypto=require('node:crypto');
const {normalizeUsage}=require('./tokens.cjs');
const hash=v=>crypto.createHash('sha256').update(String(v)).digest('hex').slice(0,10);
const text=v=>typeof v==='string'&&v? v.slice(0,200).replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[邮箱已隐藏]').replace(/(?:sk-|Bearer\s+)[\w.-]{8,}/gi,'[密钥已隐藏]'):null;
const number=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
const maskAccount=v=>v?`账号 · ${hash(v)}`:null;
const state=(status,done=true)=>!done?'running':status===499?'canceled':status>=200&&status<400?'success':status>=400?'error':'unknown';
const joinKey=(id,time)=>id==null||!time?null:`route:${id}:${time}`;
const uniqueKey=(prefix,index,time,extra='')=>`${prefix}:${index}:${time??'unknown'}:${extra}`;
const isoTime=v=>Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
function normalizeHistory(r,index=0){
 const time=isoTime(r.t);
 const join=joinKey(r.route_id,time);
 const unique=uniqueKey('history',index,time,`${r.provider||''}:${r.model||''}:${r.status??''}`);
 return {id:hash(join||unique),joinKey:join||unique,time,agent:text(r.agentName||r.agent),requestedModel:text(r.req),sentModel:text(r.model),servedModel:text(r.served),provider:text(r.providerName||r.provider),account:maskAccount(r.providerAccount||r.providerKeyName||r.providerKeyId),status:((number(r.status)==null||number(r.status)===0)&&r.err)?'error':state(r.status),httpStatus:number(r.status),durationMs:number(r.ms),ttftMs:number(r.ttft_ms),attemptCount:number(r.tries),handedOn:r.handed_on===true,...normalizeUsage(r),chain:null,source:'history'};
}
function normalizeTrace(r,index=0){
 const time=isoTime(r.time);
 const candidates=[...(Array.isArray(r.order)?r.order:[]),...(Array.isArray(r.left)?r.left:[])];
 const chain=(Array.isArray(r.tries)?r.tries:[]).map((t,i)=>{
  const c=candidates.find(c=>c.id===t.id);
  return {step:i+1,provider:text(c?.provider),account:c?.who?maskAccount(c.who):null,model:text(t.model),servedModel:text(t.served),time:isoTime(t.start),status:state(t.status,t.done===true),httpStatus:number(t.status),durationMs:number(t.ms)};
 });
 const last=chain.at(-1);
 const join=joinKey(r.id,time);
 const unique=uniqueKey('trace',index,time);
 const httpStatus=number(r.status??last?.httpStatus);
 return {id:hash(join||unique),joinKey:join||unique,time,agent:text(r.agent),requestedModel:text(r.model),sentModel:last?.model||null,servedModel:text(r.served)||last?.servedModel||null,provider:text(r.provider)||last?.provider||null,account:last?.account||null,status:r.done?(((httpStatus==null||httpStatus===0)&&r.err)?'error':state(httpStatus)):'running',httpStatus,durationMs:number(r.ms),ttftMs:number(r.ttft),attemptCount:chain.length||null,chain:chain.length?chain:null,source:'trace'};
}
function mergeRows(history,traces){
 const out=[],byJoin=new Map();
 for(const r of history){out.push(r);if(!r.joinKey)continue;const rows=byJoin.get(r.joinKey)||[];rows.push(out.length-1);byJoin.set(r.joinKey,rows);}
 for(const t of traces){
  const matches=t.joinKey?byJoin.get(t.joinKey)||[]:[];
  if(!matches.length){if(t.joinKey)byJoin.set(t.joinKey,[out.push(t)-1]);else out.push(t);continue;}
  const i=matches[0];const h=out[i];out[i]={...h,chain:t.chain,attemptCount:h.attemptCount??t.attemptCount,source:t.chain?'history+trace':'history'};
 }
 return out.sort((a,b)=>(b.time||'').localeCompare(a.time||'')||b.id.localeCompare(a.id));
}
function queryRows(rows,p){
 const size=Math.max(10,Math.min(50,Number.parseInt(p.get('size'),10)||20));
 const status=p.get('status')||'',model=(p.get('model')||'').slice(0,100).toLowerCase(),provider=p.get('provider')||'',q=(p.get('q')||'').slice(0,100).toLowerCase();
 const from=Date.parse(p.get('from')),to=Date.parse(p.get('to'));
 const filtered=rows.filter(r=>(!status||r.status===status)&&(!provider||r.provider===provider)&&(!model||[r.requestedModel,r.sentModel,r.servedModel].some(v=>v?.toLowerCase().includes(model)))&&(!q||[r.agent,r.provider,r.account,r.requestedModel,r.sentModel,r.servedModel].some(v=>v?.toLowerCase().includes(q)))&&(!Number.isFinite(from)||Date.parse(r.time)>=from)&&(!Number.isFinite(to)||Date.parse(r.time)<=to));
 const pages=Math.max(1,Math.ceil(filtered.length/size)),page=Math.max(1,Math.min(pages,Number.parseInt(p.get('page'),10)||1));
 const summarize=list=>{const result={total:list.length,running:0,success:0,error:0,canceled:0,unknown:0};for(const r of list)result[r.status]++;return result;};
 const summary=summarize(filtered),overview=summarize(rows);
 return {rows:filtered.slice((page-1)*size,page*size).map(({joinKey,...r})=>r),total:filtered.length,page,pages,size,summary,overview,providers:[...new Set(rows.map(r=>r.provider).filter(Boolean))].sort()};
}
module.exports={normalizeHistory,normalizeTrace,mergeRows,queryRows,maskAccount};
