'use strict';
// Offline-only native HTTP fixture path. No remote destination can be forwarded.
require('./OFFLINE-PRELOAD.cjs');
if(process.env.AXIOM_CB_OFFLINE==='1') {
  const guard=globalThis[Symbol.for('axiom.codebuddy.offline.guard')];
  const http=require('node:http'),https=require('node:https'),zlib=require('node:zlib');
  const {syncBuiltinESMExports}=require('node:module');
  const {state,ownedPorts,originalHttpRequest}=guard;
  const fixturePort=Number(process.env.AXIOM_CB_FIXTURE_PORT);
  if(!Number.isInteger(fixturePort)||fixturePort<1024||fixturePort>65535)throw Error('OFFLINE_FIXTURE_PORT');
  const model='deepseek-v4.1-flash',marker='AXIOM_CODEBUDDY_COMPARE_01';
  function request(input,options,callback) {
    if(typeof options==='function'){callback=options;options=undefined;}
    let base=input??{};if(typeof input==='string'||input instanceof URL){const u=new URL(input);base={protocol:u.protocol,hostname:u.hostname,port:u.port,path:u.pathname+u.search};}
    const config={...base,...options},hostname=String(config.hostname??config.host),path=String(config.path??'/');
    const local=['127.0.0.1','::1','localhost'].includes(hostname)&&ownedPorts.has(Number(config.port))&&Number(config.port)!==fixturePort;
    if(local&&path.split('?')[0]!=='/internal/agent')throw Error('OFFLINE_LOCAL_PATH');
    if(state.requests.length>=12)throw Error('OFFLINE_REQUEST_BUDGET');
    const kind=local?'owned-local-agent':path.split('?')[0]==='/v2/chat/completions'?'model':path.split('?')[0]==='/v3/config'?'catalog':'other';
    const projection={kind,hostAllowed:hostname==='copilot.tencent.com',offlinePath:path.split('?')[0],method:config.method??'GET'};state.requests.push(projection);
    let req;
    if(local)req=originalHttpRequest(config,callback);
    else {const target={...config,protocol:'http:',hostname:'127.0.0.1',host:'127.0.0.1',port:fixturePort,agent:false,headers:{...config.headers,host:hostname}};delete target._defaultAgent;delete target.createConnection;delete target.lookup;req=originalHttpRequest(target,callback);}
    const write=req.write,end=req.end;let chunks=[],size=0;
    const capture=(chunk,encoding)=>{if(chunk===undefined||chunk===null||typeof chunk==='function')return;const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk,typeof encoding==='string'?encoding:undefined);size+=bytes.length;if(size>1048576){req.destroy(Error('OFFLINE_BODY_LIMIT'));return;}chunks.push(bytes);};
    req.write=function(chunk,encoding,...rest){capture(chunk,encoding);return write.call(this,chunk,encoding,...rest);};
    req.end=function(chunk,encoding,...rest){capture(chunk,encoding);return end.call(this,chunk,encoding,...rest);};
    req.on('finish',()=>{projection.requestFinished=true;projection.bytes=size;const headers=req.getHeaders(),encoding=String(headers['content-encoding']??'');projection.contentEncoding=encoding;
      let bytes=Buffer.concat(chunks);chunks=[];try{if(encoding==='gzip')bytes=zlib.gunzipSync(bytes,{maxOutputLength:1048576});else if(encoding==='deflate')bytes=zlib.inflateSync(bytes,{maxOutputLength:1048576});else if(encoding==='br')bytes=zlib.brotliDecompressSync(bytes,{maxOutputLength:1048576});}catch{projection.decodeFailed=true;}
      if(kind==='model'){let parsed;try{parsed=JSON.parse(bytes.toString('utf8'));}catch{}projection.modelMatches=parsed?.model===model;projection.off=parsed?.reasoning_effort==='none';projection.stream=parsed?.stream===true;projection.tools=Array.isArray(parsed?.tools)?parsed.tools.length:0;projection.promptPresent=JSON.stringify(parsed?.messages??[]).includes(marker);projection.topKeys=parsed?Object.keys(parsed):[];projection.maxTokens=parsed?.max_tokens;projection.userAgent=headers['user-agent'];}
    });
    req.on('response',response=>{projection.status=response.statusCode;projection.contentType=response.headers['content-type'];if(local){const timer=setInterval(()=>{projection.localState={readableEnded:response.readableEnded,readableLength:response.readableLength,destroyed:response.destroyed,complete:response.complete,dataListeners:response.listenerCount('data'),readableListeners:response.listenerCount('readable'),endListeners:response.listenerCount('end')};},1000);timer.unref();response.once('close',()=>clearInterval(timer));}const emit=response.emit;let text='';response.emit=function(name,...args){if(name==='data'){text+=String(args[0]);projection.responseBytes=(projection.responseBytes??0)+args[0].length;projection.marker=text.includes(marker);if(text.length>8192)text=text.slice(-4096);}if(name==='end')projection.responseEnded=true;if(name==='aborted')projection.responseAborted=true;if(name==='error')projection.responseError=true;if(name==='close')projection.responseClosed=true;return emit.call(this,name,...args);};});
    const destroy=req.destroy;req.destroy=function(...args){projection.destroySites=(new Error().stack??'').match(/codebuddy-headless\.js:\d+:\d+/g)?.slice(0,5);return destroy.apply(this,args);};
    req.on('close',()=>projection.requestClosed=true);req.on('error',()=>projection.requestError=true);return req;
  }
  http.request=https.request=request;http.get=https.get=(...args)=>{const req=request(...args);req.end();return req;};http.ClientRequest=guard.originalClientRequest;
  syncBuiltinESMExports();
}
