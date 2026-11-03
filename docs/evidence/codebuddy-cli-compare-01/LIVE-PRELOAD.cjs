'use strict';
// Explicit process entry only. Importing without a selected mode is inert.
if (['fixture','live'].includes(process.env.AXIOM_CB_MODE)) {
  const fs=require('node:fs'),http=require('node:http'),https=require('node:https'),net=require('node:net'),tls=require('node:tls'),http2=require('node:http2');
  const {syncBuiltinESMExports}=require('node:module'),{createHash}=require('node:crypto');
  const {MODEL,MARKER,requestProjection,responseProjection}=require('./PROJECTION.cjs');
  const mode=process.env.AXIOM_CB_MODE,fixture=mode==='fixture',fixturePort=Number(process.env.AXIOM_CB_FIXTURE_PORT);
  const secret=JSON.parse(fs.readFileSync(3,'utf8'));
  if(typeof secret.token!=='string'||secret.token.length>32768||/[\r\n\0]/.test(secret.token))throw Error('TOKEN_INPUT');
  if(!fixture){const claim=JSON.parse(fs.readFileSync(process.env.AXIOM_CB_CLAIM,'utf8'));if(claim.parentPid!==process.ppid||claim.model!==MODEL||claim.officialModelRequests!==1||claim.catalogRequests!==1||claim.geoblockRequests!==1||claim.preloadSHA256!==createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'))throw Error('CLAIM_MISMATCH');}
  process.env.CODEBUDDY_AUTH_TOKEN=secret.token;
  const original={http:http.request.bind(http),https:https.request.bind(https),socket:net.Socket.prototype.connect,tls:tls.connect,listen:net.Server.prototype.listen,write:fs.writeSync.bind(fs)};
  const state={mode,modelRequests:0,modelSends:0,catalogRequests:0,geoblockRequests:0,telemetrySuppressed:0,networkDenied:0,childrenBlocked:0,metadataReads:0,writesSuppressed:0,activeRequests:0,ownedListeners:0,requests:[],failure:undefined};
  const ownedPorts=new Set(),active=new Set();let sendDepth=0;
  const latch=code=>{state.failure??=code;for(const req of active)req.destroy(Error(code));};
  const fail=code=>{latch(code);throw Error(code);};
  require('./ISOLATION.cjs')({roots:[process.env.HOME,process.env.TMPDIR],state,allowMetadata:!fixture});
  const localHost=host=>['127.0.0.1','::1','localhost'].includes(String(host));
  net.Server.prototype.listen=function(...args){const opt=typeof args[0]==='object'?args[0]:{port:args[0],host:typeof args[1]==='string'?args[1]:undefined};if(!localHost(opt?.host))return fail('LISTENER_HOST');this.once('listening',()=>{const address=this.address();if(!address||typeof address==='string'||!localHost(address.address)){this.close();return latch('LISTENER_ADDRESS');}ownedPorts.add(address.port);state.ownedListeners++;this.once('close',()=>{ownedPorts.delete(address.port);state.ownedListeners--;});});return original.listen.apply(this,args);};
  net.Socket.prototype.connect=function(...args){const first=Array.isArray(args[0])?args[0][0]:args[0];const opt=typeof first==='object'?first:{port:first,host:args[1]};const local=localHost(opt?.host)&&(ownedPorts.has(Number(opt?.port))||Number(opt?.port)===fixturePort);if(local||!fixture&&sendDepth>0&&opt?.host==='copilot.tencent.com'&&Number(opt?.port)===443)return original.socket.apply(this,args);state.networkDenied++;return fail('SOCKET_DESTINATION');};
  tls.connect=function(...args){const opt=args.find(value=>value&&typeof value==='object'&&!Array.isArray(value));if(!fixture&&sendDepth>0&&opt?.host==='copilot.tencent.com'&&Number(opt?.port)===443&&opt?.rejectUnauthorized!==false)return original.tls.apply(this,args);state.networkDenied++;return fail('TLS_DESTINATION');};
  const denied=()=>{state.networkDenied++;return fail('NETWORK_BYPASS');};globalThis.fetch=denied;http2.connect=denied;require('node:dgram').createSocket=denied;
  const dns=require('node:dns'),lookup=dns.lookup.bind(dns);dns.lookup=(hostname,...args)=>{if(['127.0.0.1','::1'].includes(hostname)||!fixture&&sendDepth>0&&hostname==='copilot.tencent.com')return lookup(hostname,...args);state.deniedLayer='dnsLookup';return denied();};for(const key of Object.keys(dns))if(key.startsWith('resolve')&&typeof dns[key]==='function')dns[key]=denied;for(const key of Object.keys(dns.promises))if(key==='lookup'||key.startsWith('resolve'))dns.promises[key]=async()=>denied();
  function options(input,override,callback){if(typeof override==='function'){callback=override;override=undefined;}let base=input??{};if(typeof input==='string'||input instanceof URL){const url=new URL(input);base={protocol:url.protocol,hostname:url.hostname,port:url.port,path:url.pathname+url.search};}return [{...base,...override},callback];}
  function request(input,override,callback){
    const [config,cb]=options(input,override,callback),host=String(config.hostname??config.host??''),path=String(config.path??'/'),method=String(config.method??'GET').toUpperCase();
    if(state.failure)throw Error('CASE_ALREADY_FAILED');
    if(localHost(host)&&ownedPorts.has(Number(config.port))){if(path!=='/internal/agent'||method!=='POST')return fail('LOCAL_DESTINATION');return original.http(config,cb);}
    if(host!=='copilot.tencent.com'||config.protocol&&config.protocol!=='https:'||config.port&&Number(config.port)!==443||config.rejectUnauthorized===false)return fail('REQUEST_DESTINATION');
    const initialHeaders=Object.fromEntries(Object.entries(config.headers??{}).map(([k,v])=>[k.toLowerCase(),v]));
    if(initialHeaders.expect||['createConnection','lookup','socketPath','ca','cert','key','pfx','checkServerIdentity'].some(key=>config[key]!==undefined)||config.servername&&config.servername!==host||config.agent&&config.agent!==https.globalAgent&&!(config.agent.constructor===https.Agent&&config.agent.createConnection===https.Agent.prototype.createConnection))return fail('TRANSPORT_OVERRIDE');
    let kind;
    if(method==='POST'&&path==='/v2/chat/completions'){kind='model';if(state.modelRequests++>=1)return fail('MODEL_BUDGET');}
    else if(method==='GET'&&path==='/v3/config'){kind='catalog';if(state.catalogRequests++>=1)return fail('CATALOG_BUDGET');}
    else if(method==='GET'&&path==='/v2/geoblock'){kind='geoblock';if(state.geoblockRequests++>=1)return fail('GEOBLOCK_BUDGET');}
    else if(method==='POST'&&['/v1/traces','/v2/report'].includes(path)){kind='telemetry';if(state.telemetrySuppressed++>=4)return fail('TELEMETRY_BUDGET');}
    else return fail('REQUEST_PATH');
    const record={kind,method,path};state.requests.push(record);
    const redirected=fixture||kind==='telemetry';
    if(redirected&&(!Number.isInteger(fixturePort)||fixturePort<1024||fixturePort>65535))return fail('FIXTURE_PORT');
    let target=config;
    if(redirected){target={...config,protocol:'http:',hostname:'127.0.0.1',host:'127.0.0.1',port:fixturePort,agent:false,headers:{...config.headers,host}};delete target._defaultAgent;delete target.createConnection;delete target.lookup;}
    let req;sendDepth++;try{req=(redirected?original.http:original.https)(target,cb);}finally{sendDepth--;}
    active.add(req);state.activeRequests++;
    req.once('close',()=>{if(active.delete(req))state.activeRequests--;record.closed=true;});
    req.on('error',()=>{record.transportError=true;if(kind!=='telemetry')latch('TRANSPORT_ERROR');});
    req.setTimeout(45000,()=>{record.timeout=true;latch('REQUEST_TIMEOUT');});
    let chunks=[],size=0,sending=false,ended=false;
    const write=req.write,end=req.end,setHeader=req.setHeader;
    req.setHeader=function(name,value){if(String(name).toLowerCase()==='expect')return fail('EARLY_EXPECT');return setHeader.call(this,name,value);};
    const collect=(chunk,encoding)=>{if(chunk===undefined||chunk===null||typeof chunk==='function')return;const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk,typeof encoding==='string'?encoding:undefined);size+=bytes.length;if(size>1048576)fail('REQUEST_BYTES');chunks.push(bytes);};
    req.flushHeaders=()=>fail('EARLY_FLUSH');
    req.write=function(chunk,encoding,callback){if(sending)return write.call(this,chunk,encoding,callback);collect(chunk,encoding);const done=typeof encoding==='function'?encoding:callback;if(typeof done==='function')queueMicrotask(done);return true;};
    req.end=function(chunk,encoding,callback){if(ended)return fail('REPEATED_END');ended=true;if(sending)return end.call(this,chunk,encoding,callback);collect(chunk,encoding);const bytes=Buffer.concat(chunks);chunks=[];const headers=req.getHeaders();record.requestBytes=bytes.length;
      if(kind==='model'){
        let projection;try{projection=requestProjection(bytes,headers);}catch{return fail('MODEL_BODY');}
        record.request=projection;
        if(!projection.modelMatches||!projection.off||!projection.stream||!projection.promptPresent||projection.toolCount!==0||!(projection.maxTokens>0&&projection.maxTokens<=128000)||headers.authorization!==`Bearer ${secret.token}`)return fail('MODEL_PARAMETERS');
        record.authMatches=true;
      }
      if((kind==='catalog'||kind==='geoblock')&&bytes.length!==0)return fail('GET_BODY');
      if(kind==='model')state.modelSends++;sending=true;req.write=write;const done=typeof chunk==='function'?chunk:typeof encoding==='function'?encoding:callback;
      return end.call(this,bytes,typeof done==='function'?done:undefined);
    };
    req.prependListener('response',response=>{
      record.status=response.statusCode;if(response.statusCode>=300&&response.statusCode<400){response.destroy();return latch('REDIRECT');}
      if(kind!=='telemetry'&&response.statusCode!==200){record.httpFailure=true;}
      let bytes=0,parts=[];const limit=kind==='catalog'?1048576:65536,emit=response.emit;
      response.emit=function(name,...args){
        if(name==='data'){bytes+=args[0].length;if(bytes>limit){response.destroy();latch('RESPONSE_BYTES');return false;}if(kind==='model')parts.push(Buffer.from(args[0]));}
        if(name==='end'){record.responseBytes=bytes;record.responseEnded=true;if(kind==='model'){try{record.response=responseProjection(Buffer.concat(parts),response.headers);}catch{record.responseProjectionError=true;latch('RESPONSE_PROJECTION');}parts=[];}}
        if(name==='aborted'){record.aborted=true;if(kind!=='telemetry')latch('RESPONSE_ABORTED');}
        return emit.call(this,name,...args);
      };
    });
    return req;
  }
  http.request=https.request=request;http.get=https.get=(...args)=>{const req=request(...args);req.end();return req;};
  // Native direct ClientRequest still cannot escape the Socket/TLS guards.
  syncBuiltinESMExports();
  const report=exitCode=>{try{original.write(4,JSON.stringify({...state,exitCode,headlessLoaded:Object.keys(require.cache).some(path=>path.endsWith('/dist/codebuddy-headless.js'))})+'\n');}catch{}};
  const heartbeat=setInterval(()=>report(null),5000);heartbeat.unref();process.on('exit',report);
}
