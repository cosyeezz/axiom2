 'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),https=require('node:https'),h2=require('node:http2'),dc=require('node:diagnostics_channel');
const root=__dirname,m=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
const undici=require(m.undici),{install}=require(path.join(m.source,'undici_adapter.cjs')),{headerCandidate}=require(path.join(m.source,'traffic_values.cjs'));
const names=['undici:client:sendHeaders','undici:request:bodyChunkSent','undici:request:bodySent','undici:request:error'];
const baseline=names.map(n=>dc.channel(n).hasSubscribers);
const refs={fetch:undici.fetch,globalFetch:globalThis.fetch,agentDispatch:undici.Agent.prototype.dispatch,dispatcherDispatch:undici.Dispatcher.prototype.dispatch};
const target='AmazonCodeWhispererStreamingService.GenerateAssistantResponse';
const fixture=JSON.stringify({fixture:'own-fetch-root',text:'é雪🙂'});
const result={schema:'own-fetch-root-result-1',node:process.version,platform:process.platform,arch:process.arch,pid:process.pid,scope:'own-undici-fetch-root-target-only',cases:[],ports:[],httpRequests:0,serverRequests:0,unknown:m.unknown};
const servers=[],agents=[],allSockets=new Set();
function check(v){if(!v)throw new Error('fixed-assertion');}
function own(v,k){return Object.getOwnPropertyDescriptor(v,k)?.value;}
async function pair(protocol){
 const received=[],sockets=new Set();
 const handler=(req,res)=>{result.serverRequests++;let bytes=0;const chunks=[];req.on('data',b=>{bytes+=b.length;if(bytes>65536){req.destroy();return;}chunks.push(b);});req.on('end',()=>{received.push({body:Buffer.concat(chunks),headers:req.rawHeaders.slice(),version:req.httpVersion,root:req.url==='/',method:req.method==='POST',target:req.headers['x-amz-target']===target});res.end('ok');});};
 const tls={key:fs.readFileSync(path.join(root,'key.pem')),cert:fs.readFileSync(path.join(root,'cert.pem'))};
 const server=protocol==='h1-http'?http.createServer(handler):protocol==='h1-https'?https.createServer(tls,handler):h2.createSecureServer({...tls,allowHTTP1:false},handler);
 servers.push(server);server.on('connection',s=>{sockets.add(s);allSockets.add(s);s.on('close',()=>{sockets.delete(s);allSockets.delete(s);});});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const port=server.address().port;result.ports.push({protocol,address:'127.0.0.1',port});
 const observations=[];
 for(const instrumented of [false,true]){
  const name=protocol+'-'+(instrumented?'instrumented':'control');let a,agent,entry;
  const headers=[],packets=[],chunkRequests=[];let chunkEvents=0,chunkOwnDataPresent=0,bodySentEvents=0;
  const listeners=[message=>{headers.push({request:own(message,'request'),value:own(message,'headers')});},message=>{chunkEvents++;chunkRequests.push(own(message,'request'));const d=Object.getOwnPropertyDescriptor(message,'chunk');if(d&&Object.hasOwn(d,'value')&&d.value!==undefined)chunkOwnDataPresent++;},()=>{bodySentEvents++;}];
  for(let i=0;i<listeners.length;i++)dc.channel(names[i]).subscribe(listeners[i]);
  if(instrumented)a=install(p=>packets.push(p),()=>{});
  try{
   agent=new undici.Agent({connections:1,allowH2:protocol==='h2-https',connect:protocol==='h1-http'?undefined:{ca:tls.cert,servername:'localhost'}});agents.push(agent);const dispatchBefore=agent.dispatch;
   const url=(protocol==='h1-http'?'http':'https')+'://127.0.0.1:'+port+'/';
   result.httpRequests++;
   const promise=undici.fetch(url,{method:'POST',headers:{'content-type':'application/json','x-amz-target':target},body:fixture,redirect:'error',dispatcher:agent});
   const response=await promise;check(response.status===200);check(await response.text()==='ok');
   const snapshot=a?.close();await agent.close();
   const observed=received.at(-1);check(received.length===observations.length+1);check(observed.root&&observed.method&&observed.target);check(observed.body.equals(Buffer.from(fixture,'utf8')));
   const expectedVersion=protocol==='h2-https'?'2.0':'1.1';check(observed.version===expectedVersion);
   check(headers.length===1&&typeof headers[0].value==='string');const classification=headerCandidate(headers[0].value);check(classification?.match&&classification.kind===(protocol==='h2-https'?'h2':'h1'));
   check(chunkEvents>0&&chunkOwnDataPresent===chunkEvents&&bodySentEvents===1);check(chunkRequests.every(q=>q===headers[0].request));
   check(agent.dispatch===dispatchBefore&&undici.fetch===refs.fetch&&globalThis.fetch===refs.globalFetch&&undici.Agent.prototype.dispatch===refs.agentDispatch&&undici.Dispatcher.prototype.dispatch===refs.dispatcherDispatch);
   entry={name,pass:true,serverBodyEqual:true,rootMethodTargetVerified:true,primitiveNonAsciiJsonInput:true,redirectError:true,ownAgent:true,promiseReturned:promise instanceof Promise,actualProtocol:observed.version,headerEvents:headers.length,headerClassification:classification.kind,headerRootCandidate:true,callbackChunkEvents:chunkEvents,callbackChunkOwnDataPresent:chunkOwnDataPresent,callbackChunkRequestCorrelated:true,bodySentEvents,fetchAndDispatcherReferencesUnchanged:true,
    diagnosticContentLengthPresent:/(?:^|\r\n)content-length:/i.test(headers[0].value),diagnosticTransferEncodingPresent:/(?:^|\r\n)transfer-encoding:/i.test(headers[0].value),serverContentLengthPresent:observed.headers.some(x=>typeof x==='string'&&x.toLowerCase()==='content-length')};
   if(instrumented){check(packets.length===1&&snapshot.fault==='none'&&snapshot.submitted===1&&snapshot.pending===0);check(Buffer.from(packets[0].body,'utf8').equals(observed.body));check(packets[0].header===headers[0].value);check(packets[0].headerBoundary===(protocol==='h2-https'?'undici-h2-text-view':'undici-h1-prefix'));entry={...entry,adapterBodyEqual:true,originalDiagnosticHeaderValueEqual:true,boundary:packets[0].headerBoundary,rootCandidateSubmissions:packets.length,snapshot};}
   observations.push(observed);
  }catch(_){entry={name,pass:false,failure:'fixed-fetch-case-failure',snapshot:a?.snapshot(),callbackChunkEvents:chunkEvents,callbackChunkOwnDataPresent:chunkOwnDataPresent,bodySentEvents};}
  finally{
   a?.close();let restored=true;for(let i=0;i<listeners.length;i++)restored=dc.channel(names[i]).unsubscribe(listeners[i])&&restored;
   if(agent)try{await agent.destroy();}catch(_){restored=false;}
   entry={...entry,caseObserverUnsubscribed:restored};if(!restored)entry.pass=false;
   result.cases.push(entry);
  }
 }
 if(observations.length===2){const equalBody=observations[0].body.equals(observations[1].body),equalHeaders=JSON.stringify(observations[0].headers)===JSON.stringify(observations[1].headers);const entry=result.cases.at(-1);entry.controlServerBodyEqual=equalBody;entry.controlServerRawHeadersEqual=equalHeaders;if(!equalBody||!equalHeaders)entry.pass=false;}
 for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));
}
(async()=>{
 for(const protocol of ['h1-http','h1-https','h2-https'])await pair(protocol);
 result.subscriptionBaselineRestored=names.every((n,i)=>dc.channel(n).hasSubscribers===baseline[i]);
 result.fetchAndDispatcherReferencesUnchanged=undici.fetch===refs.fetch&&globalThis.fetch===refs.globalFetch&&undici.Agent.prototype.dispatch===refs.agentDispatch&&undici.Dispatcher.prototype.dispatch===refs.dispatcherDispatch;
 result.pass=result.cases.length===6&&result.httpRequests===6&&result.serverRequests===6&&result.cases.every(c=>c.pass)&&result.subscriptionBaselineRestored&&result.fetchAndDispatcherReferencesUnchanged;
})().catch(()=>{result.pass=false;result.failure='fixed-harness-failure';}).finally(async()=>{
 for(const a of agents)try{await a.destroy();}catch(_){}
 for(const s of allSockets)s.destroy();
 for(const s of servers)try{s.closeAllConnections?.();s.close();}catch(_){}
 process.stdout.write(JSON.stringify(result)+'\n');process.exitCode=result.pass?0:1;
});
