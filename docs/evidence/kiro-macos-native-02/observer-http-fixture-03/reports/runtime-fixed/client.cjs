'use strict';
const fs=require('node:fs'),http=require('node:http'),crypto=require('node:crypto');
const mode=process.argv[2],tap=require(process.env.TAP_PATH);
const N=mode==='bodycap'?3:mode==='eventcap'?40:mode==='logcap'?20:1;
const body=mode==='bodycap'?Buffer.alloc(96*1024,0x4b):Buffer.from('');
const expected=crypto.createHash('sha256').update(body).digest('hex');
let received=0,callbacks=0,responses=0,returns=0,bytes=0,errors=[];const snapshots=[];
const server=http.createServer({maxHeaderSize:128*1024},(req,res)=>{
 const hash=crypto.createHash('sha256');let n=0;req.on('data',b=>{hash.update(b);n+=b.length});
 req.on('end',()=>{if(n!==body.length||hash.digest('hex')!==expected)errors.push('literal-body-mismatch');received++;bytes+=n;res.end('owned-ok');});
});
server.listen(0,'127.0.0.1',async()=>{try{
 for(let i=0;i<N;i++)await new Promise((resolve,reject)=>{
 const req=http.request({host:'127.0.0.1',port:server.address().port,path:'/owned',method:body.length?'POST':'GET',headers:mode==='logcap'?{'x-owned':'L'.repeat(60000)}:{},agent:false},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>{if(text!=='owned-ok')errors.push('response');responses++;snapshots.push(tap.automaticStatus());resolve()});});
 req.on('error',reject);if(req.end(body,()=>{callbacks++})===req)returns++;
 });
 // final snapshot plus post-failure requests prove first failure remains sticky.
 snapshots.push(tap.automaticStatus());
 server.close(()=>{console.log(JSON.stringify({mode,N,received,callbacks,responses,returns,bytes,expectedBodySHA:expected,errors,snapshots}));});
 }catch(e){console.error(e.stack);server.close();process.exitCode=2;}});
