'use strict';
// Authentication and request protections adapted from the reference phone dashboard.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Source}=require('./source.cjs');const {queryRows}=require('./data.cjs');const {queryTokens}=require('./tokens.cjs');const {createQuotaService}=require('./quota.cjs');
const {createCredentialStore,credentialsPath}=require('./credentials.cjs');
const DIR=__dirname,PORT=8790,TTL=12*3600*1000;
const hash=s=>crypto.createHash('sha256').update(String(s)).digest();const equal=(a,b)=>crypto.timingSafeEqual(hash(a),hash(b));
function createApp({source=new Source(),password=crypto.randomBytes(24).toString('base64url'),credentialsFile,port=PORT,publicHost,quota=createQuotaService()}={}){
 const sessions=new Map(),streams=new Map();let failures=0,windowStart=Date.now();
 const credentials=createCredentialStore({file:credentialsFile,initialPassword:password});
 function headers(res){res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cache-Control','no-store');}
 function json(res,status,body){headers(res);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));}
 function hostAllowed(req){const host=req.headers.host; if([`127.0.0.1:${port}`,`localhost:${port}`].includes(host))return true;if(typeof publicHost==='function')return host===publicHost();if(publicHost&&host===publicHost)return true;try{return host===new URL(fs.readFileSync(path.join(DIR,'tunnel-address.txt'),'utf8').trim()).host;}catch{return false;}}
 function session(req){const token=/(?:^|;\s*)_mpr=([\w-]+)/.exec(req.headers.cookie||'')?.[1],s=sessions.get(token);if(!s||s.expires<Date.now()){if(s)sessions.delete(token);return null;}if(s.desktop&&(req.headers.host!==`127.0.0.1:${port}`||req.headers['x-forwarded-proto']||req.headers['cf-connecting-ip']))return null;return {...s,token};}
 function createDesktopSession(){for(const [token,value] of sessions)if(value.desktop&&value.expires>Date.now())return token;const token=crypto.randomBytes(32).toString('base64url'),csrf=crypto.randomBytes(24).toString('base64url');sessions.set(token,{csrf,expires:Date.now()+730*TTL,desktop:true});return token;}
 function cookie(req,value,age){return `_mpr=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${req.headers['x-forwarded-proto']==='https'?'; Secure':''}`;}
 function originOk(req,write=false){const scheme=req.headers['x-forwarded-proto']==='https'?'https':'http';return req.headers['sec-fetch-site']!=='cross-site'&&req.headers['sec-fetch-site']!=='same-site'&&(!write||!!req.headers.origin)&&(!req.headers.origin||req.headers.origin===`${scheme}://${req.headers.host}`);}
 async function body(req){if(!String(req.headers['content-type']||'').startsWith('application/json'))throw new Error('type');let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>4096)throw new Error('large');}return JSON.parse(text);}
 const files={'/':['index.html','text/html; charset=utf-8'],'/quota-view.js':['quota-view.js','text/javascript; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8'],'/icon.svg':['icon.svg','image/svg+xml']};
 for(const name of ['dm-sans-latin','lora-latin','roboto-latin','noto-serif-sc-ui'])files[`/fonts/${name}.woff2`]=[`fonts/${name}.woff2`,'font/woff2'];
 async function handle(req,res){
  if(!hostAllowed(req))return json(res,403,{error:'请求主机校验失败'});
  const url=new URL(req.url,'http://local'),p=url.pathname,write=!['GET','HEAD'].includes(req.method);
  if(p.startsWith('/api/')&&!originOk(req,write))return json(res,403,{error:'请求来源校验失败'});
  if(req.method==='GET'&&files[p]){headers(res);res.writeHead(200,{'Content-Type':files[p][1]});return res.end(fs.readFileSync(path.join(DIR,'public',files[p][0])));}
  if(p==='/api/health'&&req.method==='GET')return json(res,200,{app:'magpie-requests',...(process.env.MAGPIE_INSTANCE?{instance:process.env.MAGPIE_INSTANCE}:{})});
  if(p==='/api/login'&&req.method==='POST'){
   if(Date.now()-windowStart>15*60*1000){failures=0;windowStart=Date.now();}
   if(failures>=5){res.setHeader('Retry-After',String(Math.ceil((windowStart+15*60*1000-Date.now())/1000)));return json(res,429,{error:'尝试过多，请 15 分钟后再试'});}
   const data=await body(req);if(!credentials.verify(data.password||'')){failures++;return json(res,401,{error:'口令不正确'});}
   if(sessions.size>=50){const oldestRemote=[...sessions].find(([,value])=>!value.desktop);if(oldestRemote)sessions.delete(oldestRemote[0]);}
   const token=crypto.randomBytes(32).toString('base64url'),csrf=crypto.randomBytes(24).toString('base64url');sessions.set(token,{csrf,expires:Date.now()+TTL});
   res.setHeader('Set-Cookie',cookie(req,token,TTL/1000));return json(res,200,{ok:true,csrf});
  }
  if(!p.startsWith('/api/'))return json(res,404,{error:'页面不存在'});
  const s=session(req);if(!s)return json(res,401,{error:'请先登录'});
  if(write&&!equal(req.headers['x-csrf-token']||'',s.csrf))return json(res,403,{error:'CSRF 校验失败'});
  if(p==='/api/auth-state'&&req.method==='GET')return json(res,200,{csrf:s.csrf,expires:s.expires});
  if(p==='/api/logout'&&req.method==='POST'){sessions.delete(s.token);for(const [r,token]of streams)if(token===s.token){r.end();streams.delete(r);}res.setHeader('Set-Cookie',cookie(req,'',0));return json(res,200,{ok:true});}
  if(p==='/api/password'&&req.method==='POST'){
   if(Date.now()-windowStart>15*60*1000){failures=0;windowStart=Date.now();}
   if(failures>=5){res.setHeader('Retry-After',String(Math.ceil((windowStart+15*60*1000-Date.now())/1000)));return json(res,429,{error:'尝试过多，请 15 分钟后再试'});}
   const data=await body(req);if(!credentials.verify(data.currentPassword)){failures++;return json(res,403,{error:'当前口令不正确'});}
   if(typeof data.newPassword!=='string'||!data.newPassword.length||data.newPassword.length>128)return json(res,400,{error:'新口令长度须为 1 到 128 个字符'});
   try{credentials.change(data.newPassword);}catch{return json(res,500,{error:'无法保存口令，请检查本机配置目录'});}
   for(const [token,value] of sessions)if(token!==s.token&&!value.desktop)sessions.delete(token);
   for(const [response,token]of streams)if(!sessions.has(token)){response.write('event: expired\ndata: {}\n\n');response.end();streams.delete(response);}
   return json(res,200,{ok:true});
  }
  if(p==='/api/quotas'&&req.method==='GET')return json(res,200,await quota.read({hiddenIds:url.searchParams.getAll('hidden').slice(0,500)}));
  if(p==='/api/quotas/refresh'&&req.method==='POST'){const data=await body(req);quota.refresh({automatic:data.automatic===true});return json(res,202,{accepted:true});}
  if(p==='/api/tokens'&&req.method==='GET'){const now=new Date();return json(res,200,{...queryTokens(source.history||[],url.searchParams,now),meta:source.meta,version:source.version,serverTime:now.toISOString()});}
  if(p==='/api/requests'&&req.method==='GET')return json(res,200,{...queryRows(source.rows||[],url.searchParams),meta:source.meta,version:source.version,serverTime:new Date().toISOString()});
  if(p==='/api/events'&&req.method==='GET'){
   if(streams.size>=50||[...streams.values()].filter(t=>t===s.token).length>=3)return json(res,429,{error:'实时连接过多'});
   headers(res);res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive','X-Accel-Buffering':'no'});res.write(`retry: 3000\nevent: update\ndata: ${JSON.stringify({version:source.version})}\n\n`);streams.set(res,s.token);req.on('close',()=>streams.delete(res));return;
  }
  return json(res,404,{error:'接口不存在'});
 }
 const server=http.createServer((req,res)=>handle(req,res).catch(()=>{if(!res.headersSent)json(res,400,{error:'请求格式不正确'});else res.end();}));
 server.requestTimeout=15000;server.headersTimeout=10000;
 const broadcast=()=>{for(const [res,token] of streams){const s=sessions.get(token);if(!s||s.expires<Date.now()){res.write('event: expired\ndata: {}\n\n');res.end();streams.delete(res);continue;}if(res.writableLength>65536){res.destroy();streams.delete(res);continue;}res.write(`event: update\ndata: ${JSON.stringify({version:source.version})}\n\n`);}};
 let timer;async function start(){await source.refresh();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});timer=setInterval(async()=>{try{if(await source.refresh())broadcast();}catch{if(source.meta?.history)source.meta.history={...source.meta.history,ok:false,error:'数据刷新失败，保留上次快照并自动重试'};broadcast();}},3000);timer.unref();}
 function stop(){clearInterval(timer);for(const res of streams.keys())res.end();return new Promise(resolve=>server.close(resolve));}
 return {server,start,stop,password,source,createDesktopSession};
}
if (require.main === module) {
 const app = createApp({password: 'jbc',credentialsFile: credentialsPath()});
 app.server.on('error', error => { console.error(error); process.exit(1); });
 app.start().then(() => console.log('请求看板已启动 http://127.0.0.1:8790')).catch(error => { console.error(error); process.exit(1); });
 const close = () => app.stop().then(() => process.exit(0));
 process.on('SIGINT', close);
 process.on('SIGTERM', close);
}
module.exports={createApp};
