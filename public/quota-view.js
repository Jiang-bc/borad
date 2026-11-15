'use strict';
const dashboardThemes = Object.freeze({
 github: { color: '#f6f8fa' },
 claude: { color: '#f5f4ed' },
 google: { color: '#f8fafd' },
 forest: { color: '#f4f7f1' }
});
// Apply the saved theme before the stylesheet paints, under the existing CSP.
try {
 const desktopParams = new URLSearchParams(location.search);
 if (desktopParams.get('desktop') === '1') document.documentElement.dataset.platform = 'desktop';
 const savedTheme = desktopParams.get('desktop') === '1' ? desktopParams.get('theme') || 'claude' : localStorage.getItem('magpie-theme');
 if (Object.hasOwn(dashboardThemes, savedTheme)) {
  document.documentElement.dataset.theme = savedTheme;
  document.querySelector('meta[name="theme-color"]').content = dashboardThemes[savedTheme].color;
 }
} catch {}
// Only the sanitized, aggregated quota contract reaches this renderer.
let quotaData=null,quotaSeq=0,quotaBusy=false,quotaReadAt=0,quotaAutoAt=null,quotaRefreshBusy=false;
let hiddenQuotaAccounts=new Set(),showExhausted=false;
try{
 const hidden=JSON.parse(localStorage.getItem('magpie-hidden-quota-accounts')||'[]');
 if(Array.isArray(hidden))hiddenQuotaAccounts=new Set(hidden.filter(id=>typeof id==='string'&&/^[a-f0-9]{24}$/.test(id)).slice(0,500));
 showExhausted=localStorage.getItem('magpie-show-exhausted')==='true';
}catch{}
function saveQuotaPreferences(){
 try{localStorage.setItem('magpie-hidden-quota-accounts',JSON.stringify([...hiddenQuotaAccounts]));localStorage.setItem('magpie-show-exhausted',String(showExhausted));}catch{}
}
const quotaTime=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('zh-CN',{hour12:false}):'未知';
const quotaFinite=value=>typeof value==='number'&&Number.isFinite(value);
const quotaNumber=value=>quotaFinite(value)?new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2}).format(value):'未知';
const quotaAmount=(value,unit)=>`${quotaNumber(value)}${unit?` ${unit}`:'（单位未知）'}`;
const quotaStatus={pending:'排队中',running:'采集中',ok:'读取完成',error:'采集失败',cooldown:'失败退避中',unsupported:'不支持采集'};
function quotaFreshness(c){
 if(!c.readAt||!Number.isFinite(Date.parse(c.readAt)))return '源采集时间未知，无法确认新鲜度';
 const age=Date.now()-Date.parse(c.readAt);
 if(age< -60000)return '源时间晚于当前设备时间，请核对时钟';
 return age>120000?`源数据已陈旧 · 距采集约 ${Math.floor(age/60000)} 分钟`:'源数据采集于最近 2 分钟内';
}
function quotaWindow(w){
 const percent=quotaFinite(w.remaining)?Math.max(0,Math.min(100,w.remaining)):null;
 const quantity=quotaFinite(w.limit)&&quotaFinite(w.remainingAmount);
 const value=quantity?`剩余 ${quotaAmount(w.remainingAmount,w.unit)} / 总额 ${quotaAmount(w.limit,w.unit)}`:percent===null?'剩余额度未知':`剩余 ${number(Math.round(percent*100)/100)}%`;
 const used=quotaFinite(w.amount)?`已用 ${quotaAmount(w.amount,w.unit)}`:'';
 if(w.text)return `<div class="quota-window"><strong>${esc(w.name||'额度说明')}</strong><p>${esc(w.display||'供应商暂未提供额度说明')}</p></div>`;
 const percentText=percent===null?'剩余比例未知':`剩余 ${number(Math.round(percent*100)/100)}%`;
 const reset=w.resetsAt?`重置于 ${esc(quotaTime(w.resetsAt))}`:'重置时间未知';
 return `<section class="quota-window"><div class="quota-window-heading"><strong>${esc(w.name||'额度窗口')}</strong><span class="quota-kind">${esc(w.role||'窗口额度')}</span></div><p class="quota-value">${esc(value)}</p><p class="hint">${esc([quantity?percentText:'',used].filter(Boolean).join(' · '))}</p>${percent===null?'':`<progress class="win-bar" max="100" value="${percent}" aria-label="${esc(w.name||'额度')}剩余 ${percent}%" title="剩余 ${percent}%">${percent}%</progress>`}<p class="hint">${esc(w.label||'')}${w.unknownCount?` · ${number(w.unknownCount)} 个账号额度未知`:''}</p>${w.note?`<p class="hint">${esc(w.note)}</p>`:''}<p class="hint">${reset}${w.resetTimesDiffer?' · 各账号重置时间不同':''}${w.resetTimeUnknownCount?` · ${number(w.resetTimeUnknownCount)} 个账号重置时间未知`:''}</p></section>`;
}
function quotaCard(c){
 const balances=Array.isArray(c.balances)?c.balances:[];
 const balanceSection=balances.length?`<section class="quota-balance-section"><div class="quota-window-heading"><strong>${c.balanceUnknownCount?'已知余额（部分账号未知）':'总余额'}</strong><span class="quota-kind">${c.kind==='balance'?'余额账号':'账户余额'}</span></div>${balances.map(b=>`<p class="quota-balance"><span class="sr-only">剩余余额：</span>${esc(b.display||quotaAmount(b.amount,b.unit))}${b.unit?'':'（单位未知，不跨账号相加）'}</p>`).join('')}${(c.balanceNotes||[]).length?`<p class="hint">分项说明，不重复计入余额：${c.balanceNotes.map(esc).join('；')}</p>`:''}</section>`:'';
 const windows=(c.windows||[]).map(w=>c.provider==='workbuddy'&&/^(?:total credits|credits|extra credits)$/i.test(w.name)?{...w,role:w.primary?'总额度（含分项）':'分项（已含总额）'}:w);
 const windowSection=windows.length?`<div class="quota-window-list">${windows.map(quotaWindow).join('')}</div>`:balances.length?'':'<p class="hint">暂无可读取的余额或额度窗口</p>';
 const state=quotaData?.refresh?.perProvider?.[c.provider];
 const progress=state?`<p class="quota-provider-state" role="status">采集进度：${esc(quotaStatus[state.status]||'状态未知')}${state.note?` · ${esc(state.note)}`:''}${state.retryAt?` · 可重试于 ${esc(quotaTime(state.retryAt))}`:''}</p>`:'';
 return `<article class="quota-card" data-provider="${esc(c.provider)}"><div class="quota-card-heading"><h2>${esc(c.name||c.provider)}</h2><span>${number(c.accountCount)} 个账号</span></div>${c.plan?`<p class="hint">${esc(c.plan)}</p>`:''}${c.last?'<p class="hint">最近服务过的供应商</p>':''}${progress}${c.error?`<p class="notice">${esc(c.error)}</p>`:''}${c.retained?'<p class="hint">保留上次采集数据</p>':''}${balanceSection}${c.balanceUnknownCount?`<p class="hint">${number(c.balanceUnknownCount)} 个账号余额未知</p>`:''}${windowSection}<p class="quota-collected">供应商采集：${esc(quotaTime(c.readAt))}${c.readAtLatest&&c.readAtLatest!==c.readAt?` — ${esc(quotaTime(c.readAtLatest))}`:''}</p><p class="hint">${esc(quotaFreshness(c))}</p><p class="hint">${esc(c.readAtNote||'')}</p></article>`;
}
function renderQuotaCards(cards){
 const container=$('quota-cards'),existing=new Map([...container.querySelectorAll('.quota-card')].map(element=>[element.dataset.provider,element])),visible=new Set(cards.map(card=>card.provider));
 for(const [provider,element] of existing)if(!visible.has(provider))element.remove();
 if(!cards.length){if(!container.querySelector('.empty'))container.innerHTML='<div class="empty">当前没有可显示的剩余额度。可切换供应商或刷新重试；查询失败的历史数据会保留。</div>';return;}
 container.querySelector('.empty')?.remove();
 for(const card of cards){const template=document.createElement('template');template.innerHTML=quotaCard(card);const next=template.content.firstElementChild,current=existing.get(card.provider);if(current){if(current.innerHTML!==next.innerHTML)current.innerHTML=next.innerHTML;}else container.append(next);}
}
function renderQuotas(data){
 quotaData=data;
 const accounts=Array.isArray(data.accounts)?data.accounts:[],accountList=$('quota-account-list'),signature=JSON.stringify(accounts);
 if(accountList.dataset.signature!==signature){
  accountList.innerHTML=accounts.map(account=>`<label class="check-option" for="quota-account-${esc(account.id)}"><input id="quota-account-${esc(account.id)}" type="checkbox" value="${esc(account.id)}"><span>${esc(account.provider)} · ${esc(account.label)}</span></label>`).join('')||'<p class="hint">暂无可选择的账号。</p>';
  accountList.dataset.signature=signature;
 }
 for(const input of accountList.querySelectorAll('input[type="checkbox"]'))input.checked=!hiddenQuotaAccounts.has(input.value);
 const hiddenCount=accounts.filter(account=>hiddenQuotaAccounts.has(account.id)).length;
 $('quota-account-count').textContent=hiddenCount?`· 已隐藏 ${number(hiddenCount)} 个`:'';
 const cards=Array.isArray(data.cards)?data.cards:[],filter=$('quota-provider').value;
 const available=new Set(cards.map(c=>c.provider));if(filter)available.add(filter);
 const providers=[...$('quota-provider').options].map(option=>option.value).filter(value=>value&&available.delete(value));providers.push(...available);
 const providerSignature=JSON.stringify(providers);if($('quota-provider').dataset.signature!==providerSignature){$('quota-provider').innerHTML='<option value="">全部供应商</option>'+providers.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join('');$('quota-provider').dataset.signature=providerSignature;}$('quota-provider').value=filter;
 const exhausted=cards.filter(c=>c.isExhausted===true&&!c.error),shown=cards.filter(c=>(showExhausted||c.isExhausted!==true||c.error)&&(!filter||c.provider===filter));
 $('quota-count').textContent=`显示 ${number(shown.length)} 个供应商${showExhausted?'':` · 已隐藏 ${number(exhausted.length)} 个额度耗尽组`}${hiddenCount?` · ${number(hiddenCount)} 个账号未计入`:''}`;
 renderQuotaCards(shown);
 const refresh=data.refresh||{},states=Object.values(refresh.perProvider||{}),done=states.filter(s=>!['pending','running'].includes(s.status)).length;
 const detail=Object.entries(refresh.perProvider||{}).map(([provider,state])=>`${provider}：${quotaStatus[state.status]||'状态未知'}`).join('；');
 $('quota-refresh-state').textContent=(data.refreshing?`正在采集供应商额度：${done} / ${states.length} 完成`:(refresh.finishedAt?`上次采集完成：${quotaTime(refresh.finishedAt)}${refresh.error?` · ${refresh.error}`:' · 完成'}`:'额度页可见且未暂停时，每 60 秒采集供应商；缓存每 3 秒同步。'))+(detail?` · ${detail}`:'');
 const issues=[data.fetchError,refresh.error].filter(Boolean);$('quota-notice').hidden=!issues.length;$('quota-notice').textContent=issues.join('；');
 $('quota-read-time').textContent=`看板读取缓存：${quotaTime(data.fetchedAt)}。供应商采集时间见各组；读取缓存不会改变采集时间。`;
 $('quota-refresh').disabled=!!data.refreshing;$('quota-cards').setAttribute('aria-busy',String(!!data.refreshing));
 $('updated').textContent=`缓存读取于 ${quotaTime(data.fetchedAt)}`;
 readConnection(data.refreshing?'正在采集额度':issues.length?'额度采集或读取失败 · 保留历史':'额度缓存自动同步',issues.length?'warn':'live');
}
async function loadQuotas(manual=true){
 if(!manual&&(quotaBusy||Date.now()-quotaReadAt<(quotaData?.refreshing?1500:3000)))return;
 const id=++quotaSeq;quotaBusy=true;quotaReadAt=Date.now();
 try{const params=new URLSearchParams();for(const accountId of hiddenQuotaAccounts)params.append('hidden',accountId);const query=params.toString(),data=await api('/api/quotas'+(query?'?'+query:''));if(id!==quotaSeq)return;renderQuotas(data);maybeRefreshQuotas();}
 catch(e){if(id!==quotaSeq)return;$('quota-notice').hidden=false;$('quota-notice').textContent=`${e.message}。${quotaData?'保留上次显示的额度。':'暂时无法读取额度。'}请稍后重试。`;connection('额度读取失败');$('quota-cards').setAttribute('aria-busy','false');if(!quotaData)$('quota-cards').innerHTML='<div class="empty">暂时无法读取额度，请稍后重试。</div>';}
 finally{if(id===quotaSeq)quotaBusy=false;}
}
function maybeRefreshQuotas(){
 if(view!=='quota'||!csrf||paused||document.hidden||quotaRefreshBusy||quotaData?.refreshing)return;
 const interval=Math.max(60000,quotaData?.autoRefreshIntervalMs||60000);
 if(quotaAutoAt!==null&&Date.now()-quotaAutoAt<interval)return;
 const next=Date.parse(quotaData?.nextAutoRefreshAt);if(Number.isFinite(next)&&Date.now()<next)return;
 refreshQuotas(true);
}
async function refreshQuotas(automatic=false){
 automatic=automatic===true;
 if(quotaRefreshBusy)return;
 if(automatic&&(view!=='quota'||!csrf||paused||document.hidden))return;
 quotaRefreshBusy=true;quotaAutoAt=Date.now();
 $('quota-refresh').disabled=true;
 try{await api('/api/quotas/refresh',{method:'POST',body:JSON.stringify({automatic})});if(view==='quota'&&csrf)await loadQuotas();}
 catch(e){if(view==='quota'&&csrf){$('quota-notice').hidden=false;$('quota-notice').textContent=`${e.message}。保留上次显示的额度。`;}}
 finally{quotaRefreshBusy=false;if(!quotaData?.refreshing)$('quota-refresh').disabled=false;}
}
