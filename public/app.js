'use strict';
const $=id=>document.getElementById(id),form=$('filters');
function applyTheme(value){
 const theme=Object.hasOwn(dashboardThemes,value)?value:'github';
 document.documentElement.dataset.theme=theme;
 $('theme-select').value=theme;
 document.querySelector('meta[name="theme-color"]').content=dashboardThemes[theme].color;
}
applyTheme(document.documentElement.dataset.theme);
$('theme-select').addEventListener('change',event=>{
 applyTheme(event.target.value);
 try{localStorage.setItem('magpie-theme',document.documentElement.dataset.theme);}catch{}
});
let csrf='',events=null,paused=false,page=1,boundary=null,seq=0,retryTimer=null,loaded=false,lastData=null,lastBoundary=null,lastEventAt=0,pollTimer=null;
let view='requests',tokenRange='today',tokenPage=1,tokenSeq=0,tokenData=null,tokenBusy=false;
function parsePage(value,pages){const text=String(value).trim();if(!/^\d+$/.test(text))return null;const n=Number(text);return Number.isSafeInteger(n)&&n>=1?Math.min(n,Math.max(1,pages)):null;}
function syncPageInput(prefix,current,pages,empty=false,force=false){const input=$(prefix+'page-input');input.max=String(pages);input.disabled=empty;$(prefix+'page-go').disabled=empty;if(force||empty||input.dataset.submitted||document.activeElement!==input){input.value=String(current);input.setAttribute('aria-invalid','false');$(prefix+'page-error').textContent='';delete input.dataset.submitted;}}
function pageJumpBusy(prefix){$(prefix+'page-input').disabled=true;$(prefix+'page-go').disabled=true;}
function jumpPage(prefix){const tokens=prefix==='token-';if(tokens&&tokenBusy)return;const data=tokens?tokenData:lastData,input=$(prefix+'page-input'),target=parsePage(input.value,data?.pages||1);$(prefix+'page-error').textContent='';if(target===null){input.setAttribute('aria-invalid','true');$(prefix+'page-error').textContent='请输入大于等于 1 的整数页码。';input.focus();return;}input.setAttribute('aria-invalid','false');input.value=String(target);if(!data||!data.total)return;input.dataset.submitted='true';if(tokens){tokenPage=target;}else{if(target>1&&!boundary)boundary=lastData.serverTime||new Date().toISOString();if(target===1)boundary=null;page=target;}load();}
const number=v=>v==null?'未记录':Number(v).toLocaleString('zh-CN');
const nonnegative=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
function formatTokens(v){
 if(v==null)return '未记录';
 if(!nonnegative(v))return '未记录';
 if(v===0)return '0 M';
 if(v<1)return '<0.000001 M';
 return `${(v/1000000).toLocaleString('en-US',{minimumFractionDigits:3,maximumFractionDigits:v<10000?6:3})} M`;
}
const tokenTitle=v=>v==null?'未记录':`${number(v)} token · 1 M = 1,000,000 token`;
function formatUsd(v,summary=false){
 if(!nonnegative(v))return '未定价';
 if(v===0)return '$0.00';
 if(v<0.000001)return '<$0.000001';
 const digits=summary?(v>=1?2:v>=0.0001?4:6):(v>=1?4:6);
 return `$${v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:digits})}`;
}
const costTitle=v=>nonnegative(v)?`API 参考价估算：$${v} USD`:'未定价 · 等待后端估算';
const tokenDay=v=>v?new Date(v).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit'}):'未记录';
const tokenTime=v=>v?new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}):'未记录';
const eventFresh=()=>Date.now()-lastEventAt<6500;
const labels={success:'已完成',error:'失败',running:'执行中',canceled:'已取消',unknown:'未记录状态'};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=v=>v?new Date(v).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}):'未记录时间';
const duration=v=>v==null?'未记录':v<1000?`${Math.round(v)} ms`:v<60000?`${(v/1000).toFixed(2)} s`:`${Math.floor(v/60000)} 分 ${Math.round(v%60000/1000)} 秒`;
const status=r=>`<span class="status ${esc(r.status)}">${labels[r.status]||labels.unknown}${r.httpStatus?` · ${r.httpStatus}`:''}</span>`;
function connection(text,kind='warn'){$('connection').textContent=text;$('connection-dot').className=`connection-dot ${kind}`;}
function readConnection(text,kind='live'){connection(paused?'已暂停 · 快照保留':text,paused?'warn':kind);}
async function api(url,options={}){const r=await fetch(url,{...options,headers:{...(options.body?{'Content-Type':'application/json','X-CSRF-Token':csrf}:{}),...options.headers},signal:AbortSignal.timeout(url==='/api/quotas'?20000:10000)});const data=await r.json();if(!r.ok){if(r.status===401&&url!='/api/login')showLogin();throw new Error(data.error||'连接失败');}return data;}
function resetPasswordVisibility(){for(const id of ['current-password','new-password']){$(id).type='password';$(id).removeAttribute('aria-invalid');}$('show-passwords').setAttribute('aria-pressed','false');$('show-passwords').textContent='显示口令';}
function showLogin(){events?.close();events=null;clearTimeout(retryTimer);clearInterval(pollTimer);seq++;tokenSeq++;tokenBusy=false;quotaSeq++;quotaBusy=false;csrf='';$('password-form').reset();resetPasswordVisibility();$('password-change-message').textContent='';$('dashboard').hidden=true;$('login').hidden=false;}
function showDashboard(){$('login').hidden=true;$('dashboard').hidden=false;switchView(globalThis.location?.hash?.slice(1)||'requests');connect();clearInterval(pollTimer);pollTimer=setInterval(()=>{if(!csrf||document.hidden)return;const collecting=view==='quota'&&quotaData?.refreshing;if(collecting||(!paused&&(view==='quota'||!eventFresh())))load(false);},3000);}
function params(){const p=new URLSearchParams(new FormData(form));for(const field of ['from','to']){if(p.get(field)){const d=new Date(p.get(field));if(!Number.isNaN(+d))p.set(field,d.toISOString());else p.delete(field);}}if(boundary&&!p.get('to'))p.set('to',boundary);p.set('page',page);return p;}
function card(r){const liveMs=r.status==='running'&&r.time?Math.max(0,Date.now()-Date.parse(r.time)):r.durationMs;const attempts=r.attemptCount??r.chain?.length;const provider=r.provider||(r.status==='running'?'等待上游选择':'供应商未记录');const fields=[['请求时间',r.time?new Date(r.time).toLocaleString('zh-CN',{hour12:false}):null],['调用来源',r.agent],['目标模型',r.requestedModel],['发送模型',r.sentModel],['实际服务模型',r.servedModel],['实际供应商',r.provider],['账号（脱敏）',r.account],['请求状态',`${labels[r.status]||labels.unknown}${r.httpStatus?` · HTTP ${r.httpStatus}`:''}`],['请求耗时',`${duration(liveMs)}${r.status==='running'?'（已执行，按本机时间估算）':''}`],['首字节耗时',r.ttftMs==null?null:duration(r.ttftMs)],['尝试次数',attempts==null?null:String(attempts)],['记录来源',r.source==='history+trace'?'历史 + 实时追踪':r.source==='trace'?'实时追踪':'历史日志']];
 const chain=r.chain?.length?`<ol class="chain">${r.chain.map(t=>`<li><span class="step-number">${t.step}</span><div class="step-top"><strong class="provider">${esc(t.provider||'供应商未记录')}</strong>${status(t)}</div><div class="step-desc">${esc(t.account||'账号未记录')}<br>${esc(t.model||'模型未记录')} · ${esc(duration(t.durationMs))}${t.time?`<br>${esc(date(t.time))}`:''}</div></li>`).join('')}</ol><p class="chain-note">以上为实际执行顺序；候选供应商与配置规则不计入链路。</p>`:r.attemptCount>1?`<p class="hint">该请求经历 ${r.attemptCount} 次尝试后${r.status==='success'?'成功':'结束'}；逐次尝试的供应商明细未被源保留。不会据此补写或推测回退路径。</p>`:`<p class="hint">源数据未保留逐次尝试链路。不会据此补写或推测回退路径。</p>`;
 return `<details class="request" data-id="${esc(r.id)}"><summary><span class="request-main">${status(r)}<span class="model" title="目标模型：${esc(r.requestedModel||'未记录')}"><span class="sr-only">目标模型：</span>${esc(r.requestedModel||'未记录目标模型')}</span><span class="duration" title="${r.status==='running'?'已执行，按本机时间估算':'请求耗时'}"><span class="sr-only">${r.status==='running'?'已执行（按本机时间估算）':'请求耗时'}：</span>${esc(duration(liveMs))}</span><span class="expand-icon" aria-hidden="true">›</span><span class="sr-only expand-closed">展开详情</span><span class="sr-only expand-open">收起详情</span></span><span class="request-meta"><time class="request-time" datetime="${esc(r.time)}">${esc(date(r.time))}</time><span class="route-meta" title="${esc(`${provider} · ${r.account||'账号未记录'}`)}"><span class="sr-only">实际供应商：</span>${esc(provider)}<span class="account"> · ${esc(r.account||'账号未记录')}</span></span><span class="request-origin" title="调用来源：${esc(r.agent||'未记录')}">${esc(r.agent||'来源未记录')}</span>${attempts>1?`<span class="attempts">${attempts} 次尝试</span>`:''}</span></summary><div class="details-body"><table class="detail-table"><caption>请求详情</caption><tbody>${fields.map(([label,value])=>`<tr><th scope="row">${label}</th><td>${esc(value||'未记录')}</td></tr>`).join('')}</tbody></table><h3 class="chain-title">尝试与回退链</h3>${chain}${r.handedOn?'<p class="hint">源记录标记了转交；具体转交路径未必保留。</p>':''}</div></details>`;
}
function render(data){lastData=data;page=data.page;if(page===1)boundary=null;lastBoundary=boundary;const open=new Set([...document.querySelectorAll('.request[open]')].map(e=>e.dataset.id));const focused=document.activeElement.closest?.('.request')?.dataset.id;
 $('request-list').innerHTML=data.rows.length?data.rows.map(card).join(''):'<div class="empty"><strong>这里暂时没有请求</strong>试试调整筛选条件，或等待新的模型调用。</div>';
 for(const el of document.querySelectorAll('.request'))if(open.has(el.dataset.id))el.open=true;
 if(focused){const el=[...document.querySelectorAll('.request')].find(e=>e.dataset.id===focused);el?.querySelector('summary').focus({preventScroll:true});}
 const overview=data.overview||data.summary;
 for(const key of ['total','running','success','error'])$(key).textContent=overview[key].toLocaleString('zh-CN');
 $('result-count').textContent=`当前 ${data.total.toLocaleString('zh-CN')} 条`;syncPageInput('',page,data.pages,!data.total);$('page-label').textContent=`第 ${page} / ${data.pages} 页`;$('prev').disabled=page===1;$('next').disabled=page===data.pages;
 $('page-note').hidden=page===1;$('updated').textContent=`读取于 ${new Date(data.serverTime).toLocaleTimeString('zh-CN',{hour12:false})}`;
 const selection=$('provider').value;const options=['',...data.providers];if(selection&&!options.includes(selection))options.push(selection);
 const optionSig=options.join('|');if($('provider').dataset.options!==optionSig){$('provider').innerHTML=options.map(v=>`<option value="${esc(v)}">${esc(v||'全部供应商')}</option>`).join('');$('provider').value=selection;$('provider').dataset.options=optionSig;}
 const issues=[data.meta.history.error,data.meta.trace.error,data.meta.history.invalidLines?`${data.meta.history.invalidLines} 行历史暂无法解析，稍后重读。`:null].filter(Boolean);$('notice').hidden=!issues.length;$('notice').textContent=issues.join('；');
 $('source-time').textContent=`历史读取：${date(data.meta.history.readAt)} · 追踪读取：${date(data.meta.trace.readAt)}。时间按当前设备时区显示。`;
 readConnection(data.meta.trace.ok?(eventFresh()?'实时事件连接':'自动刷新 · 每 3 秒'):'数据源暂时断开',data.meta.trace.ok?'live':'warn');
 $('request-list').setAttribute('aria-busy','false');loaded=true;
}
const viewNames=['requests','tokens','quota','settings'];
function switchView(next,updateHash=true){
 view=viewNames.includes(next)?next:'requests';seq++;tokenSeq++;tokenBusy=false;quotaSeq++;quotaBusy=false;
 $('request-list').setAttribute('aria-busy','false');$('token-rows').setAttribute('aria-busy','false');$('refresh').disabled=false;$('token-refresh').disabled=false;
 for(const name of viewNames){const active=name===view;$(`view-${name}`).hidden=!active;$(`tab-${name}`).setAttribute('aria-selected',String(active));$(`tab-${name}`).setAttribute('tabindex',active?'0':'-1');}
 $('title').textContent={requests:'请求流水',tokens:'Token 用量',quota:'剩余额度',settings:'设置'}[view];
 if(updateHash)globalThis.history?.replaceState(null,'',`#${view}`);
 $('updated').textContent='正在读取…';load();
}
function tokenParams(){return new URLSearchParams({range:tokenRange,provider:$('token-provider').value,page:String(tokenPage),size:$('token-size').value||'20'});}
function tokenCard(r){
 const usage=[['输入 Token',r.inputTokens],['输出 Token',r.outputTokens],['缓存读取 Token',r.cacheReadTokens],['缓存写入 Token',r.cacheWriteTokens],['总 Token（输入 + 输出）',r.totalTokens]];
 const prices=r.unitPrices||{};
 const fields=[['请求时间',r.time?new Date(r.time).toLocaleString('zh-CN',{hour12:false}):null],['目标模型',r.requestedModel],['发送模型',r.sentModel],['实际服务模型',r.servedModel],['实际供应商',r.provider],['账号（脱敏）',r.account],['请求状态',labels[r.status]||labels.unknown],...usage.map(([label,value])=>[label,formatTokens(value),tokenTitle(value)]),['消耗 / USD（API 参考价估算）',formatUsd(r.estimatedCostUsd),costTitle(r.estimatedCostUsd)],['计价匹配型号',r.priceModel],['价格来源',r.priceSource],...['input','output','cacheRead','cacheWrite'].map((key,i)=>[`${['输入','输出','缓存读取','缓存写入'][i]}单价（USD / 1M token）`,formatUsd(prices[key])]),['计费说明',r.pricingNote||'由后端按 API 参考价估算，费用单独考虑缓存；不代表实际支付。']];
 return `<details class="token-record" data-id="${esc(r.id)}"><summary><div class="request-main"><strong class="model" title="${esc(r.requestedModel||'模型未记录')}">${esc(r.requestedModel||'模型未记录')}</strong><span class="token-row-total" title="${esc(tokenTitle(r.totalTokens))}">${esc(formatTokens(r.totalTokens))}</span><span class="expand-icon" aria-hidden="true">⌄</span></div><div class="request-meta"><time class="request-time" datetime="${esc(r.time||'')}">${esc(date(r.time))}</time><span class="token-row-provider" title="${esc(r.provider||'供应商未记录')}">${esc(r.provider||'供应商未记录')}</span><span class="token-row-cost" title="${esc(costTitle(r.estimatedCostUsd))}">API 估算 ${esc(formatUsd(r.estimatedCostUsd))}</span><span class="token-row-breakdown">输入 ${esc(formatTokens(r.inputTokens))} · 输出 ${esc(formatTokens(r.outputTokens))}</span></div></summary><div class="details-body"><table class="detail-table"><caption>Token 用量详情</caption><tbody>${fields.map(([label,value,title])=>`<tr><th scope="row">${esc(label)}</th><td${title?` title="${esc(title)}"`:''}>${esc(value??'未记录')}</td></tr>`).join('')}</tbody></table></div></details>`;
}
function renderTokens(data){
 tokenData=data;tokenPage=data.page;
 const open=new Set([...document.querySelectorAll('.token-record[open]')].map(e=>e.dataset.id));
 const focused=document.activeElement.closest?.('.token-record')?.dataset.id;
 $('token-rows').innerHTML=data.rows.length?data.rows.map(tokenCard).join(''):'<div class="empty"><strong>这段时间暂无用量记录</strong>试试近 7 天或切换供应商；未记录 Token 的历史请求仍会显示。</div>';
 for(const el of document.querySelectorAll('.token-record'))if(open.has(el.dataset.id))el.open=true;
 if(focused){const el=[...document.querySelectorAll('.token-record')].find(e=>e.dataset.id===focused);el?.querySelector('summary').focus({preventScroll:true});}
 for(const [id,key] of [['total','totalTokens'],['input','inputTokens'],['output','outputTokens'],['cache-read','cacheReadTokens'],['cache-write','cacheWriteTokens']]){
  $(`token-${id}`).textContent=formatTokens(data.summary[key]);
  $(`token-${id}`).setAttribute('title',tokenTitle(data.summary[key]));
 }
 const summary=data.summary,cost=summary.estimatedCostUsd;
 $('token-cost').textContent=cost===undefined?'待计算':formatUsd(cost,true);
 $('token-cost').setAttribute('title',costTitle(cost));
 const priced=nonnegative(summary.pricedRequests)?summary.pricedRequests:null;
 const unpriced=nonnegative(summary.unpricedRequests)?summary.unpricedRequests:null;
 const coverage=unpriced>0?`${nonnegative(cost)?'已估算部分':'估算待完成'}，另有 ${number(unpriced)} 条未定价`:priced!=null?`已估算 ${number(priced)} 条${priced===0?'，暂无已定价请求':''}`:'定价覆盖待计算';
 $('token-cost-coverage').textContent=`API 参考价估算 · ${coverage}；不代表实际账单。`;
 $('token-result-count').textContent=`当前 ${number(data.total)} 条`;
 $('token-page-label').textContent=`第 ${data.page} / ${data.pages} 页`;syncPageInput('token-',data.page,data.pages,!data.total);
 $('token-prev').disabled=data.page<=1;$('token-next').disabled=data.page>=data.pages;
 $('token-page-note').hidden=data.page<=1;
 $('token-coverage').textContent=`${number(data.summary.requests)} 条历史请求${data.summary.missingUsageRequests?` · ${number(data.summary.missingUsageRequests)} 条缺少输入或输出用量，汇总可能不完整`:' · 输入、输出均已记录'}`;
 if(!data.summary.requests)$('token-coverage').textContent='当前范围没有历史请求，Token 用量未记录。';
 $('token-period').textContent=`${data.range==='7d'?'近 7 天（含今天）':'今天'} · ${tokenDay(data.from)}—${tokenDay(data.to)} · ${$('token-provider').value||'全部供应商'} · 北京时间 UTC+8`;
 const selection=$('token-provider').value,options=['',...data.providers];if(selection&&!options.includes(selection))options.push(selection);
 const signature=JSON.stringify(options);if($('token-provider').dataset.options!==signature){$('token-provider').innerHTML=options.map(v=>`<option value="${esc(v)}">${esc(v||'全部供应商')}</option>`).join('');$('token-provider').value=selection;$('token-provider').dataset.options=signature;}
 const history=data.meta?.history||{},issues=[history.error,history.invalidLines?`${history.invalidLines} 行历史暂无法解析，汇总可能不完整。`:null].filter(Boolean);
 $('token-notice').hidden=!issues.length;$('token-notice').textContent=issues.join('；');
 $('token-source-time').textContent=`历史读取：${date(history.readAt)}。统计窗口（北京时间）：${tokenTime(data.from)} — ${tokenTime(data.to)}。`;
 $('updated').textContent=`读取于 ${new Date(data.serverTime).toLocaleTimeString('zh-CN',{hour12:false})}`;
 readConnection(data.page>1?'历史分页 · 自动刷新暂停':history.ok===false?'历史数据源暂时断开':'历史用量 · 每 3 秒刷新',history.ok===false?'warn':'live');
 $('token-rows').setAttribute('aria-busy','false');
}
function resetTokens(){
 tokenPage=1;tokenData=null;
 for(const id of ['total','input','output','cache-read','cache-write']){$(`token-${id}`).textContent='—';$(`token-${id}`).setAttribute('title','正在读取所选范围');}
 $('token-cost').textContent='待计算';$('token-cost').setAttribute('title','正在读取所选范围');
 $('token-cost-coverage').textContent='API 参考价估算 · 正在读取所选范围；不代表实际账单。';
 $('token-coverage').textContent='正在读取所选范围…';$('token-result-count').textContent='正在读取…';$('token-page-label').textContent='第 1 页';$('token-page-note').hidden=true;
 $('token-period').textContent=`${tokenRange==='7d'?'近 7 天（含今天）':'今天'} · ${$('token-provider').value||'全部供应商'} · 北京时间 UTC+8`;
 $('token-source-time').textContent='等待数据源';$('token-rows').innerHTML='<div class="empty">正在读取历史 Token 用量…</div>';load();
}
async function loadTokens(manual=true){
 if(!manual&&(tokenBusy||tokenPage>1))return;
 const id=++tokenSeq;tokenBusy=true;if(manual||!tokenData)pageJumpBusy('token-');$('token-rows').setAttribute('aria-busy','true');$('token-refresh').disabled=true;$('token-prev').disabled=true;$('token-next').disabled=true;
 try{const data=await api('/api/tokens?'+tokenParams());if(id!==tokenSeq)return;renderTokens(data);}
 catch(e){if(id!==tokenSeq)return;tokenPage=tokenData?.page||tokenPage;if(tokenData)syncPageInput('token-',tokenPage,tokenData.pages,!tokenData.total,true);$('token-notice').hidden=false;$('token-notice').textContent=tokenData?`${e.message}。保留上次显示的用量，点击刷新重试。`:`${e.message}。暂时无法读取 Token 用量，请稍后刷新。`;connection('Token 用量读取失败');if(!tokenData){$('token-result-count').textContent='读取失败';$('token-coverage').textContent='暂时无法读取所选范围。';$('token-rows').innerHTML='<div class="empty"><strong>暂时无法读取用量</strong>点击刷新重试。</div>';}}
 finally{if(id===tokenSeq){tokenBusy=false;syncPageInput('token-',tokenPage,tokenData?.pages||1,!tokenData?.total);$('token-rows').setAttribute('aria-busy','false');$('token-refresh').disabled=false;$('token-prev').disabled=tokenPage<=1;$('token-next').disabled=!tokenData||tokenPage>=tokenData.pages;}}
}
async function load(manual=true){if(view==='settings')return;if(view==='quota')return loadQuotas(manual);if(view==='tokens')return loadTokens(manual);const mySeq=++seq;if(manual||!lastData)pageJumpBusy('');$('refresh').disabled=true;try{const data=await api('/api/requests?'+params());if(mySeq!==seq)return;render(data);}catch(e){if(mySeq!==seq)return;if(lastData){page=lastData.page;boundary=lastBoundary;syncPageInput('',page,lastData.pages,!lastData.total,true);}$('notice').hidden=false;$('notice').textContent=`${e.message}。保留上次显示，正在等待恢复。`;connection('连接中断 · 自动重试');if(!loaded)$('request-list').innerHTML='<p class="empty">暂时无法读取请求。连接恢复后会自动更新。</p>';}finally{if(mySeq===seq){$('refresh').disabled=false;syncPageInput('',page,lastData?.pages||1,!lastData?.total);}}}
function connect(){events?.close();clearTimeout(retryTimer);if(paused||!csrf)return;connection('正在连接');events=new EventSource('/api/events');events.onopen=()=>{connection('连接已建立 · 等待事件');clearTimeout(retryTimer);};events.addEventListener('update',()=>{lastEventAt=Date.now();if(!paused&&!document.hidden)load(false);});events.addEventListener('expired',()=>{showLogin();$('login-error').textContent='会话已过期，请重新登录。';});events.onerror=()=>{connection('连接中断 · 正在重连');clearTimeout(retryTimer);retryTimer=setTimeout(()=>{if(!paused&&csrf)load(false);},5000);};}
$('tab-requests').addEventListener('click',()=>switchView('requests'));
$('tab-tokens').addEventListener('click',()=>switchView('tokens'));
$('tab-quota').addEventListener('click',()=>switchView('quota'));
$('tab-settings').addEventListener('click',()=>switchView('settings'));
$('quota-provider').addEventListener('change',()=>{if(quotaData)renderQuotas(quotaData);});
$('quota-refresh').addEventListener('click',refreshQuotas);
$('quota-account-list').addEventListener('change',event=>{
 const input=event.target;if(input.type!=='checkbox'||!/^[a-f0-9]{24}$/.test(input.value))return;
 if(input.checked)hiddenQuotaAccounts.delete(input.value);else hiddenQuotaAccounts.add(input.value);
 saveQuotaPreferences();quotaData=null;$('quota-cards').innerHTML='<p class="empty">正在更新额度汇总…</p>';loadQuotas();
});
$('show-exhausted').checked=showExhausted;
$('show-exhausted').addEventListener('change',event=>{showExhausted=event.target.checked;saveQuotaPreferences();if(quotaData)renderQuotas(quotaData);});
for(const prefix of ['', 'token-'])$(prefix+'page-jump').addEventListener('submit',e=>{e.preventDefault();jumpPage(prefix);});
const tabLayout=matchMedia('(max-width: 760px)'),tabList=document.querySelector('.view-tabs');
function syncTabOrientation(){tabList.setAttribute('aria-orientation',tabLayout.matches?'horizontal':'vertical');}
syncTabOrientation();tabLayout.addEventListener('change',syncTabOrientation);
for(const name of viewNames)$(`tab-${name}`).addEventListener('keydown',e=>{
 const forward=tabLayout.matches?'ArrowRight':'ArrowDown',backward=tabLayout.matches?'ArrowLeft':'ArrowUp';
 if(![forward,backward,'Home','End'].includes(e.key))return;
 e.preventDefault();const i=viewNames.indexOf(name),next=e.key==='Home'?viewNames[0]:e.key==='End'?viewNames[viewNames.length-1]:viewNames[(i+(e.key===forward?1:viewNames.length-1))%viewNames.length];switchView(next);$(`tab-${next}`).focus();
});
$('show-passwords').addEventListener('click',event=>{const visible=event.currentTarget.getAttribute('aria-pressed')!=='true';for(const id of ['current-password','new-password'])$(id).type=visible?'text':'password';event.currentTarget.setAttribute('aria-pressed',String(visible));event.currentTarget.textContent=visible?'隐藏口令':'显示口令';});
for(const id of ['current-password','new-password'])$(id).addEventListener('input',event=>{event.target.removeAttribute('aria-invalid');$('password-change-message').textContent='';});
$('password-form').addEventListener('submit',async event=>{
 event.preventDefault();const passwordForm=event.currentTarget,button=passwordForm.querySelector('button[type="submit"]'),message=$('password-change-message');button.disabled=true;message.textContent='';
 try{await api('/api/password',{method:'POST',body:JSON.stringify({currentPassword:$('current-password').value,newPassword:$('new-password').value})});passwordForm.reset();resetPasswordVisibility();message.className='settings-success';message.textContent='口令已更新，其他设备需要重新登录。';}
 catch(error){message.className='error-text';message.textContent=error.message;if(error.message==='当前口令不正确'){$('current-password').setAttribute('aria-invalid','true');$('current-password').focus();}}
 finally{button.disabled=false;}
});
globalThis.addEventListener?.('hashchange',()=>{if(csrf)switchView(globalThis.location.hash.slice(1),false);});
for(const [id,range] of [['token-today','today'],['token-week','7d']])$(id).addEventListener('click',()=>{
 if(tokenRange===range)return;tokenRange=range;$('token-today').setAttribute('aria-pressed',String(range==='today'));$('token-week').setAttribute('aria-pressed',String(range==='7d'));resetTokens();
});
$('token-filters').addEventListener('change',resetTokens);
$('token-filters').addEventListener('submit',e=>{e.preventDefault();load();});
$('token-prev').addEventListener('click',()=>{if(tokenPage>1&&!tokenBusy){tokenPage--;load();}});
$('token-next').addEventListener('click',()=>{if(tokenData&&tokenPage<tokenData.pages&&!tokenBusy){tokenPage++;load();}});
$('login-form').addEventListener('submit',async e=>{e.preventDefault();const button=e.currentTarget.querySelector('button');button.disabled=true;$('login-error').textContent='';try{const data=await api('/api/login',{method:'POST',body:JSON.stringify({password:$('password').value})});csrf=data.csrf;$('password').value='';showDashboard();}catch(e){$('login-error').textContent=e.message;}finally{button.disabled=false;}});
$('logout').addEventListener('click',async()=>{try{await api('/api/logout',{method:'POST',body:'{}'});showLogin();}catch(e){$('notice').hidden=false;$('notice').textContent=e.message;}});
$('pause').addEventListener('click',()=>{paused=!paused;$('pause').textContent=paused?'恢复更新':'暂停更新';$('pause').setAttribute('aria-pressed',String(paused));if(paused){events?.close();clearTimeout(retryTimer);connection('已暂停 · 快照保留');}else{connect();load();}});
$('refresh').addEventListener('click',()=>load());
form.addEventListener('submit',e=>{e.preventDefault();const from=form.elements.from.value,to=form.elements.to.value;if(from&&to&&from>to){$('notice').hidden=false;$('notice').textContent='起始时间不能晚于结束时间。';return;}page=1;boundary=null;updateFilterCount();load();});
function updateFilterCount(){const n=['q','status','provider','model','from','to'].filter(k=>form.elements[k].value).length;$('filter-count').textContent=n?`· ${n} 项`:'';}
let debounce;form.elements.q.addEventListener('input',()=>{clearTimeout(debounce);debounce=setTimeout(()=>{page=1;boundary=null;updateFilterCount();load();},350);});
form.addEventListener('reset',()=>setTimeout(()=>{page=1;boundary=null;updateFilterCount();load();},0));
$('next').addEventListener('click',()=>{if(page===1)boundary=lastData?.serverTime||new Date().toISOString();page++;load();});$('prev').addEventListener('click',()=>{page=Math.max(1,page-1);if(page===1)boundary=null;load();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!paused&&csrf){connect();load(false);}});
(async()=>{try{const data=await api('/api/auth-state');csrf=data.csrf;showDashboard();}catch{showLogin();}})();
