 'use strict';
const fs=require('node:fs'),http=require('node:http'),net=require('node:net'),tls=require('node:tls');
const root=process.env.OWN, src=process.env.SOURCE;
const A=require(src+'/node_http_adapter.cjs');
const report={version:process.version,platform:process.platform,arch:process.arch,cases:0,requests:0,passed:0,failed:0,httpPort:0,httpsPort:0,restores:0};
const deadline=setTimeout(()=>{process.stdout.write(JSON.stringify({...report,timedOut:true})+'\n');process.exit(124)},13000);
function ok(v){if(!v)throw null;}
function descSame(a,b){return ['value','writable','enumerable','configurable','get','set'].every(k=>a?.[k]===b?.[k]);}
function descriptors(p){return ['write','end'].map(k=>Object.getOwnPropertyDescriptor(p,k));}
function restored(p,d){ok(descriptors(p).every((x,i)=>descSame(x,d[i])));report.restores++;}
function fake(end){const p={write:function(){return this;},end:end||function(){return this;}};return p;}
const header='POST /v1/responses HTTP/1.1\r\nHost: localhost\r\n\r\n', body='{"test":"own-utf8-\u03bb"}';
function obj(p){return Object.assign(Object.create(p),{_header:header});}
function setup(p,sink){const d=descriptors(p), packets=[],faults=[];const a=A.installOnPrototype(p,sink||((v)=>packets.push(v)),v=>faults.push(v));ok(a.snapshot().state==='active');return {a,d,packets,faults};}
function finish(p,t,f){ok(t.a.snapshot().fault===f);t.a.close();restored(p,t.d);}
async function run(fn){report.cases++;try{await fn();report.passed++;}catch(_){report.failed++;}}
async function pair(secure){
 const received=[]; let serverFault=false;
 const handler=s=>{let chunks=[],size=0;s.on('error',()=>{serverFault=true});s.on('data',b=>{size+=b.length;if(size>16384){serverFault=true;s.destroy();return;}chunks.push(b);const all=Buffer.concat(chunks),i=all.indexOf('\r\n\r\n');if(i<0)return;const h=all.subarray(0,i+4), m=/\r\nContent-Length: ([0-9]+)\r\n/i.exec(h.toString('latin1'));if(!m){serverFault=true;s.destroy();return;}if(all.length<i+4+Number(m[1]))return;received.push({h:Buffer.from(h),b:Buffer.from(all.subarray(i+4))});s.end('HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');});};
 const server=secure?tls.createServer({key:fs.readFileSync(root+'/key.pem'),cert:fs.readFileSync(root+'/cert.pem')},handler):net.createServer(handler);
 server.on('tlsClientError',()=>{serverFault=true});
 await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r)});
 const port=server.address().port;report[secure?'httpsPort':'httpPort']=port;
 let captures=[],t,control;
 const p=http.ClientRequest.prototype,d=descriptors(p);
 async function send(instrumented){
  let callbackCount=0,callbackArgs=-1,callbackThis=false,finishCount=0,cache,returnSame,listenersSame;
  await new Promise((resolve,reject)=>{
   const req=(secure?require('node:https'):http).request({host:'127.0.0.1',port,method:'POST',path:'/v1/responses',agent:false,headers:{Host:'localhost','Content-Length':Buffer.byteLength(body),'Connection':'close'},...(secure?{ca:fs.readFileSync(root+'/cert.pem'),servername:'localhost'}:{})},res=>{res.resume();res.on('end',resolve);res.on('error',reject)});
   req.on('error',reject);req.on('finish',()=>{finishCount++});
   const events=req.eventNames(),before=events.map(e=>req.rawListeners(e));
   const returned=req.end(body,'utf8',function(){callbackCount++;callbackArgs=arguments.length;callbackThis=this===req;});
   returnSame=returned===req;cache=req._header;
   // end itself adds the caller callback; compare the existing listener prefix only.
   listenersSame=events.every((e,i)=>before[i].every((v,j)=>req.rawListeners(e)[j]===v));
  });
  report.requests++;ok(callbackCount===1&&callbackArgs===0&&finishCount===1&&returnSame&&listenersSame);
  return {callbackCount,callbackArgs,callbackThis,finishCount,returnSame,listenersSame,cache};
 }
 try{
  control=await send(false);t=A.install(v=>captures.push(v),()=>{});ok(t.snapshot().state==='active');
  const inst=await send(true);ok(received.length===2&&!serverFault);
  ok(received[0].h.equals(received[1].h)&&received[0].b.equals(received[1].b));
  ok(received[1].b.equals(Buffer.from(body))&&captures.length===1);
  ok(captures[0].header===inst.cache&&Buffer.from(captures[0].header,'latin1').equals(received[1].h)&&captures[0].body===body);
  ok(['callbackCount','callbackArgs','callbackThis','finishCount','returnSame','listenersSame'].every(k=>control[k]===inst[k]));
  ok(t.close().fault==='none');restored(p,d);
 }finally{if(t)t.close();await new Promise(r=>server.close(r));}
}
(async()=>{
 await run(()=>pair(false));await run(()=>pair(true));
 await run(()=>{let n=0,receiver,args;const sentinel={};const p=fake(function(){n++;receiver=this;args=Array.from(arguments);throw sentinel}),t=setup(p),o=obj(p),cb=()=>{};let caught;try{o.end(body,'utf8',cb)}catch(e){caught=e}ok(caught===sentinel&&n===1&&receiver===o&&args.length===3&&args[0]===body&&args[1]==='utf8'&&args[2]===cb&&t.packets.length===0);finish(p,t,'original-threw');});
 await run(()=>{let n=0;const p=fake(function(){n++;return this}),t=setup(p),o=obj(p);ok(o.end(Buffer.from(body))===o&&n===1&&t.packets.length===0);finish(p,t,'unsupported-candidate-body');});
 await run(()=>{const p=fake(),t=setup(p),o=obj(p);ok(o.write('a')===o&&o.end(body)===o&&t.packets.length===0);finish(p,t,'unsupported-candidate-body');});
 await run(()=>{let n=0;const p=fake(function(){n++;if(n===1)this.end(body);return this}),t=setup(p),o=obj(p);ok(o.end(body)===o&&n===2&&t.packets.length===0);finish(p,t,'reentrant-request');});
 await run(()=>{const p=fake(),t=setup(p),o=obj(p);ok(o.end(body)===o&&o.end(body)===o&&t.packets.length===1);finish(p,t,'repeated-end');});
 await run(()=>{let n=0;const p=fake(function(){n++;return this}),t=setup(p),saved=p.end,o=obj(p);t.a.close();restored(p,t.d);ok(saved.call(o,body)===o&&n===1&&t.a.snapshot().fault==='late-call');ok(t.a.close().fault==='late-call');});
 await run(()=>{let n=0;const p=fake(function(){n++;return this}),t=setup(p,()=>{throw null}),o=obj(p);ok(o.end(body)===o&&n===1);finish(p,t,'sink-threw');});
 await run(()=>{let n=0;const p=fake(function(){n++;return this}),t=setup(p);for(let i=0;i<5;i++){const o=obj(p);ok(o.end(body)===o)}ok(n===5&&t.packets.length===4);finish(p,t,'candidate-cap');});
 await run(()=>{let n=0;const p=fake();p.write=function(){n++;return this};const t=setup(p),o=obj(p);for(let i=0;i<129;i++)ok(o.write('a')===o);ok(n===129&&t.packets.length===0);finish(p,t,'call-cap');});
 await run(()=>{const p=fake(),t=setup(p),newOwner=function(){return this};Object.defineProperty(p,'end',{value:newOwner,writable:false,enumerable:false,configurable:true});ok(t.a.close().state==='conflict'&&t.a.snapshot().fault==='restore-conflict');const d=Object.getOwnPropertyDescriptor(p,'end');ok(d.value===newOwner&&d.writable===false&&d.enumerable===false&&descSame(Object.getOwnPropertyDescriptor(p,'write'),t.d[0]));});
 clearTimeout(deadline);process.stdout.write(JSON.stringify({...report,timedOut:false})+'\n');process.exitCode=report.failed?1:0;
})().catch(()=>{clearTimeout(deadline);process.stdout.write(JSON.stringify({...report,fatal:true,timedOut:false})+'\n');process.exitCode=2;});
