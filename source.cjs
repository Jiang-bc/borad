'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {normalizeHistory,normalizeTrace,mergeRows}=require('./data.cjs');
class Source {
 constructor(){this.root=process.env.MAGPIE_DATA_DIR||path.join(process.env.USERPROFILE||process.env.HOME,'.config','magpie');this.history=[];this.traces=[];this.version=0;this.historyStamp='';this.busy=false;this.meta={history:{ok:false,readAt:null,error:null,invalidLines:0},trace:{ok:false,readAt:null,error:null},pollMs:3000,chainNote:'仅显示 Magpie 追踪接口保留的真实尝试；较早请求可能没有链路。'};}
 async refresh(){
  if(this.busy)return false;this.busy=true;
  try{await Promise.all([this.readHistory(),this.readTrace()]);this.rows=mergeRows(this.history,this.traces);this.version++;return true;}finally{this.busy=false;}
 }
 async readHistory(){
  try{
   const filename=path.join(this.root,'usage.jsonl'),stat=await fs.stat(filename),stamp=`${stat.ino}:${stat.mtimeMs}:${stat.size}`;
   if(stamp!==this.historyStamp){
    if(stat.size>150*1024*1024)throw new Error('history-too-large');
    const contents=await fs.readFile(filename,'utf8');const lines=contents.split('\n'),rows=[];let invalid=0;
    lines.forEach((line,i)=>{if(!line.trim())return;try{rows.push(normalizeHistory(JSON.parse(line),i));}catch{invalid++;}});
    this.history=rows;this.historyStamp=invalid?'':stamp;this.meta.history.invalidLines=invalid;
   }
   this.meta.history={...this.meta.history,ok:true,readAt:new Date().toISOString(),error:null,records:this.history.length};
  }catch(e){this.meta.history={...this.meta.history,ok:false,error:e.message==='history-too-large'?'历史文件超过 150 MB 读取上限，保留上次快照':'无法读取本机历史文件，保留上次快照'};}
 }
 async readTrace(){
  try{
   // Credentials are read only into process memory; never forwarded to the browser or logs.
   const settings=JSON.parse(await fs.readFile(path.join(this.root,'settings.json'),'utf8'));
   const headers=settings.lanKey?{Authorization:`Bearer ${settings.lanKey}`}:{ };
   const response=await fetch('http://127.0.0.1:3425/v1/magpie/trace',{headers,signal:AbortSignal.timeout(2300)});
   if(!response.ok)throw new Error('unavailable');const data=await response.json();
   if(!Array.isArray(data.routes))throw new Error('schema');
   this.traces=data.routes.map(normalizeTrace);this.meta.trace={ok:true,readAt:new Date().toISOString(),error:null,records:this.traces.length};
  }catch{this.meta.trace={...this.meta.trace,ok:false,error:'实时追踪暂不可用，保留上次快照；状态可能已变化'};}
 }
}
module.exports={Source};
