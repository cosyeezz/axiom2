 'use strict';
const fs=require('node:fs'), path=require('node:path'), http=require('node:http'), https=require('node:https'), h2=require('node:http2'), dc=require('node:diagnostics_channel');
const root=__dirname, m=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
const {install}=require(path.join(m.source,'undici_adapter.cjs'));
const {copyChunk,LIMIT}=require(path.join(m.source,'traffic_values.cjs'));
const undici=require(m.undici);
const names=['undici:client:sendHeaders','undici:request:bodyChunkSent','undici:request:bodySent','undici:request:error'];
const baseline=names.map(n=>dc.channel(n).hasSubscribers);
const refs=[globalThis.fetch,undici.Client.prototype.request,undici.Client.prototype.dispatch,undici.Dispatcher.prototype.dispatch];
const result={schema:'own-undici-check-1',node:process.version,platform:process.platform,arch:process.arch,pid:process.pid,cases:[],ports:[],httpRequests:0,serverRequests:0,unknown:['saved-late-callback','DC aggregate-byte-cap','DC chunk-count-cap','DC record-cap','DC candidate-cap','header-size-cap','original thrown identity not exercised'],scope:'own-transport-only'};
const ownServers=[],ownClients=[];
function check(v){if(!v)throw new Error('fixed-assertion');}
function record(name,fn){try{const detail=fn(); result.cases.push({name,pass:true,...detail});}catch(_){result.cases.push({name,pass:false,failure:'fixed-assertion'});}}
const fixtureBody='{"fixture":"own","unicode":"é雪"}';
const syntheticHeader='POST /v1/responses HTTP/1.1\r\nHost: localhost\r\n';
function pub(name,obj){dc.channel(name).publish(obj);}
function hdr(request,headers=syntheticHeader){pub(names[0],{request,headers});}
function chunk(request,chunk){pub(names[1],{request,chunk});}
function sent(request){pub(names[2],{request});}
function synth(name,fn){record(name,()=>{let packets=0,faults=[];const a=install(()=>{packets++;if(name==='sink-exception')throw new Error('fixed-synthetic');},v=>faults.push(v));try{return fn(a,()=>packets,faults);}finally{a.close();}});}
async function pair(protocol){
 let received=[], sockets=new Set();
 const handler=(req,res)=>{result.serverRequests++;const chunks=[];let n=0;req.on('data',b=>{n+=b.length;if(n>65536){req.destroy();return;}chunks.push(b);});req.on('end',()=>{received.push({body:Buffer.concat(chunks),headers:req.rawHeaders.slice(),version:req.httpVersion});res.end('ok');});};
 const tls={key:fs.readFileSync(path.join(root,'key.pem')),cert:fs.readFileSync(path.join(root,'cert.pem'))};
 let server=protocol==='h1-http'?http.createServer(handler):protocol==='h1-https'?https.createServer(tls,handler):h2.createSecureServer({...tls,allowHTTP1:false},handler);
 ownServers.push(server);server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const port=server.address().port;result.ports.push({protocol,address:'127.0.0.1',port});
 const observations=[];
 for(const instrumented of [false,true]){
  const name=protocol+'-'+(instrumented?'instrumented':'control');
  let originalHeaders=[],packets=[],adapter,closed,client;
  const listener=message=>{const d=Object.getOwnPropertyDescriptor(message,'headers');if(d&&typeof d.value==='string')originalHeaders.push(d.value);};
  dc.channel(names[0]).subscribe(listener);
  if(instrumented)adapter=install(p=>packets.push(p),()=>{});
  try{
   client=new undici.Client((protocol==='h1-http'?'http':'https')+'://127.0.0.1:'+port,{allowH2:protocol==='h2-https',connect:protocol==='h1-http'?undefined:{ca:tls.cert,servername:'localhost'}});ownClients.push(client);
   result.httpRequests++;
   const returned=client.request({path:'/v1/responses',method:'POST',headers:{'content-type':'application/json','x-own-fixture':'constant'},body:fixtureBody});
   const response=await returned;check(response.statusCode===200);check(await response.body.text()==='ok');
   if(adapter)closed=adapter.close();
   await client.close();
   const observed=received.at(-1);check(received.length===observations.length+1);check(observed.body.equals(Buffer.from(fixtureBody)));check(originalHeaders.length===1);
   check(observed.version===(protocol==='h2-https'?'2.0':'1.1'));
   let details={serverBodyEqual:true,promiseReturned:returned instanceof Promise,actualProtocol:observed.version,headerEvents:originalHeaders.length};
   if(instrumented){check(packets.length===1);check(Buffer.from(packets[0].body).equals(observed.body));check(packets[0].header===originalHeaders[0]);check(packets[0].headerBoundary===(protocol==='h2-https'?'undici-h2-text-view':'undici-h1-prefix'));check(closed.fault==='none'&&closed.submitted===1&&closed.pending===0);
    details={...details,captureBytesEqual:true,originalHeaderValueEqual:true,boundary:packets[0].headerBoundary,snapshot:closed,
      diagnosticContentLengthPresent:/(?:^|\r\n)content-length:/i.test(packets[0].header),diagnosticTransferEncodingPresent:/(?:^|\r\n)transfer-encoding:/i.test(packets[0].header),serverContentLengthPresent:observed.headers.some(x=>typeof x==='string'&&x.toLowerCase()==='content-length')};
   }
   observations.push({body:observed.body,headers:observed.headers});
   result.cases.push({name,pass:true,...details});
  }catch(_){result.cases.push({name,pass:false,failure:'fixed-transport-failure',snapshot:adapter?.snapshot()});}
  finally{adapter?.close();check(dc.channel(names[0]).unsubscribe(listener));if(client)await client.destroy();}
 }
 if(observations.length===2){const a=observations[0],b=observations[1];result.cases[result.cases.length-1].controlBodyEqual=a.body.equals(b.body);result.cases[result.cases.length-1].controlRawHeadersEqual=JSON.stringify(a.headers)===JSON.stringify(b.headers);check(a.body.equals(b.body));check(JSON.stringify(a.headers)===JSON.stringify(b.headers));}
 for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));
}
(async()=>{
 for(const p of ['h1-http','h1-https','h2-https'])await pair(p);
 synth('duplicate-bodySent',(a,count,faults)=>{const q={};hdr(q);chunk(q,'ok');sent(q);check(count()===1);sent(q);check(a.snapshot().fault==='late-request-event');check(count()===1&&faults.length===1);return {fault:a.close().fault,submissions:count()};});
 synth('missing-bodySent',(a,count)=>{const q={};hdr(q);chunk(q,'ok');check(count()===0);const s=a.close();check(s.fault==='incomplete-candidate');return {fault:s.fault,submissions:count()};});
 synth('sink-exception',(a,count,faults)=>{const q={};hdr(q);chunk(q,'ok');sent(q);const s=a.close();check(s.fault==='sink-threw'&&s.submitted===0&&count()===1&&faults.length===1);return {fault:s.fault,sinkCalls:count(),submissions:s.submitted};});
 synth('values-and-invalid-utf8',(a,count)=>{
  let getters=0;const value=new Uint8Array([1,2,3]);for(const k of ['buffer','byteOffset','byteLength','length'])Object.defineProperty(value,k,{get(){getters++;throw new Error('fixed');}});Object.defineProperty(value,Symbol.toStringTag,{get(){getters++;throw new Error('fixed');}});
  check(copyChunk(value,3).equals(Buffer.from([1,2,3]))&&getters===0);
  check(copyChunk(new Uint8Array(new SharedArrayBuffer(4)),4)===null);check(copyChunk(new Uint8Array(new ArrayBuffer(4,{maxByteLength:8})),4)===null);
  check(copyChunk(new Uint8Array(LIMIT.body+1),LIMIT.body)===null);check(copyChunk('雪',2)===null);check(copyChunk('雪',3).equals(Buffer.from('雪')));check(copyChunk(new Uint8Array(4),3)===null);
  const q={};hdr(q);chunk(q,new Uint8Array([0xc3,0x28]));sent(q);const s=a.close();check(s.fault==='observer-fault'&&count()===0);return {fault:s.fault,getterCalls:getters,sharedRejected:true,resizableRejected:true,byteLimitRejected:true,utf8ByteLimitRejected:true,invalidUtf8Rejected:true};
 });
 synth('call-cap',(a,count)=>{const q={};hdr(q,'POST /oauth/token HTTP/1.1\r\nHost: localhost\r\n');for(let i=0;i<128;i++)chunk(q,'ignored');const s=a.close();check(s.calls===128&&s.fault==='call-cap'&&count()===0);return {fault:s.fault,calls:s.calls,submissions:count()};});
 synth('oauth-filter',(a,count)=>{const q={};hdr(q,'POST /oauth/token HTTP/1.1\r\nHost: localhost\r\n');let getters=0;const message={request:q};Object.defineProperty(message,'chunk',{get(){getters++;throw new Error('fixed');}});pub(names[1],message);sent(q);const s=a.close();check(count()===0&&getters===0&&s.fault==='none'&&s.candidates===0);return {submissions:0,getterCalls:getters,fault:s.fault};});
 result.subscriptionBaselineRestored=names.every((n,i)=>dc.channel(n).hasSubscribers===baseline[i]);
 result.apiIdentityUnchanged=refs.every((v,i)=>v===[globalThis.fetch,undici.Client.prototype.request,undici.Client.prototype.dispatch,undici.Dispatcher.prototype.dispatch][i]);
 result.pass=result.cases.length===12&&result.httpRequests===6&&result.serverRequests===6&&result.cases.every(c=>c.pass)&&result.subscriptionBaselineRestored&&result.apiIdentityUnchanged;
})().catch(()=>{result.pass=false;result.failure='fixed-harness-failure';}).finally(async()=>{
 for(const c of ownClients)try{await c.destroy();}catch(_){}
 for(const s of ownServers)try{s.closeAllConnections?.();s.close();}catch(_){}
 process.stdout.write(JSON.stringify(result)+'\n');process.exitCode=result.pass?0:1;
});
