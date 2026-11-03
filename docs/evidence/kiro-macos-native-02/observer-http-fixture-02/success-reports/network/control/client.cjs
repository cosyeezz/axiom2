 'use strict';
const http=require('node:http'),https=require('node:https'),fs=require('node:fs');
const lexicalGet=http.get, afterGet=https.get;
const cfg=JSON.parse(fs.readFileSync('config.json','utf8'));
const out={pid:process.pid,version:process.version,platform:process.platform,arch:process.arch,cases:[]};
async function run(lib,scheme,port,name){
 const cb={},ret={};const count=k=>()=>{cb[k]=(cb[k]||0)+1};
 const headers={'Host':'owned.invalid','X-Fake':'calibration','Connection':'keep-alive'};
 const opts={host:'127.0.0.1',port,path:'/'+name,method:name.includes('get')?'GET':'POST',headers,agent:scheme==='http'?ha:sa};
 if(scheme==='https')opts.ca=fs.readFileSync('cert.pem');
 await new Promise((resolve,reject)=>{
 let req;
 const response=res=>{let b=[];res.on('data',x=>b.push(x));res.on('end',()=>{if(Buffer.concat(b).toString()!=='OK')reject(Error('bad response'));else resolve()});res.on('error',reject)};
 if(name==='lexical-get')req=lexicalGet(opts,response);
 else if(name==='after-get')req=afterGet(opts,response);
 else if(name==='large')req=lib.request(new URL(scheme+'://127.0.0.1:'+port+'/'+name),{...opts,highWaterMark:1024},response);
 else req=lib.request(opts,response);
 req.on('error',reject);
 if(name==='mixed'){
 ret.utf8=req.write('é','utf8',count('utf8'));
 ret.latin1=req.write('é','latin1',count('latin1'));
 ret.buffer=req.write(Buffer.from([0,255,65]),count('buffer'));
 ret.view=req.write(new Uint8Array(new Uint8Array([8,66,67,9]).buffer,1,2),count('view'));
 ret.empty=req.write('',count('empty'));
 ret.end=req.end(count('end'))===req;
 } else if(name==='large') {ret.large=req.write(Buffer.alloc(96*1024,0x4c),count('large'));ret.end=req.end(count('end'))===req;}
 else if(name==='mutable') {const b=Buffer.from('BEFORE');req.cork();ret.write=req.write(b,count('write'));b.fill(0x5a);req.uncork();ret.end=req.end(count('end'))===req;}
 else if(name==='invalid') {try{req.write({bad:true});ret.invalid='NO_THROW'}catch(e){ret.invalid=e.code}ret.end=req.end(Buffer.alloc(0),count('end'))===req;}
 });
 out.cases.push({scheme,name,cb,ret});
}
const ha=new http.Agent({keepAlive:true,maxSockets:1}),sa=new https.Agent({keepAlive:true,maxSockets:1});
(async()=>{try{
 for(const [lib,s,p] of [[http,'http',cfg.http],[https,'https',cfg.https]]){
 for(const n of ['mixed','large','mutable','invalid',s==='http'?'lexical-get':'after-get'])await run(lib,s,p,n);
 }
 ha.destroy();sa.destroy();
 fs.writeFileSync('client-terminal.json',JSON.stringify({ok:true,pid:process.pid}),{flag:'wx',mode:0o600});
 console.log(JSON.stringify(out));
 }catch(e){ha.destroy();sa.destroy();console.error(e.stack);process.exitCode=1}})();
