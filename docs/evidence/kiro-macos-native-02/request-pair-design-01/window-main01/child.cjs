'use strict';
const fs=require('node:fs'),http=require('node:http');
const {installWindow}=require('/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02/request-pair-design-01/first_request_window.cjs');
const {body,pick}=require('./fixture_data.cjs');
const [mode,endpoint,port,file]=process.argv.slice(2);let w,ok=false,earlyQueued=false,readyBeforeHttp=false,version=null;
const check=x=>{if(!x)throw null};
(async()=>{
 if(mode==='node'){
  w=installWindow(endpoint,{deadlineMs:3000});
  const response=new Promise((resolve,reject)=>{
   const q=http.request({host:'127.0.0.1',port:Number(port),path:'/v1/responses',method:'POST',agent:false,headers:{'Content-Type':'application/json'}},r=>{r.resume();r.on('end',()=>resolve(r.statusCode))});
   q.on('error',()=>reject(null));const returned=q.end(body);check(returned===q);
  });
  const before=w.snapshot();earlyQueued=!before.channelReady&&before.observedCandidates===1&&before.queuedFrames===3;
  check(earlyQueued);check(await response===200);
 }else{
  check(mode==='undici');const undici=require('/Volumes/D_Work/axiom2/app/node_modules/undici');version=require('/Volumes/D_Work/axiom2/app/node_modules/undici/package.json').version;
  const agent=new undici.Agent();w=installWindow(endpoint,{deadlineMs:3000});
  try{check(await w.ready);readyBeforeHttp=true;const r=await undici.fetch('http://127.0.0.1:'+port+'/',{method:'POST',headers:{'Content-Type':'application/json','x-amz-target':'AmazonCodeWhispererStreamingService.GenerateAssistantResponse'},body,dispatcher:agent});check(r.status===200);await r.arrayBuffer()}finally{await agent.close()}
 }
 await w.done;const s=pick(w);check(s.state==='window-closed'&&s.fault==='none'&&s.windowClosed&&s.observedCandidates===1&&s.reservedFrames===5&&s.queuedFrames===0&&s.nodeState==='closed'&&s.undiciState==='closed'&&s.channelState==='closed');ok=true;
})().catch(()=>{if(w)w.abort()}).finally(()=>{
 const result={mode,ok,pid:process.pid,node:process.version,platform:process.platform,arch:process.arch,undiciVersion:version,earlyQueued,readyBeforeHttp,window:w?pick(w):null};
 try{fs.writeFileSync(file,JSON.stringify(result),{flag:'wx',mode:0o600})}catch(_){ok=false}
 process.exitCode=ok?0:1;
});
