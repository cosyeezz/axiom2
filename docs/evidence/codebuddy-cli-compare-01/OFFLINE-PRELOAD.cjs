'use strict';
// Explicit OFFLINE-only preload. It can never forward a request to the network.
if (process.env.AXIOM_CB_OFFLINE === '1') {
  const fs = require('node:fs'), net = require('node:net'), tls = require('node:tls');
  const http = require('node:http'), https = require('node:https'), http2 = require('node:http2');
  const cp = require('node:child_process'), wt = require('node:worker_threads');
  const { Writable, PassThrough } = require('node:stream');
  const { syncBuiltinESMExports } = require('node:module');
  const originalWriteSync = fs.writeSync.bind(fs), originalOpenSync = fs.openSync.bind(fs);
  const originalClientRequest = http.ClientRequest;
  const originalHttpRequest = http.request.bind(http), originalConnect = net.Socket.prototype.connect, originalListen = net.Server.prototype.listen;
  const ownedPorts = new Set(process.env.AXIOM_CB_FIXTURE_PORT ? [Number(process.env.AXIOM_CB_FIXTURE_PORT)] : []);
  const state = { offline: true, networkAttempts: 0, childAttempts: 0, childCalls: [], writesSuppressed: 0, loopbackConnections: 0, ownedListeners: 0, requests: [], failure: undefined };
  const model = 'deepseek-v4.1-flash', marker = 'AXIOM_CODEBUDDY_COMPARE_01';
  const deny = () => { state.networkAttempts++; throw Error('OFFLINE_NETWORK_BLOCKED'); };
  net.Socket.prototype.connect = function (...args) { const first=Array.isArray(args[0])?args[0][0]:args[0]; const opt=typeof first==='object'?first:{port:first,host:args[1]}; if(ownedPorts.has(Number(opt?.port))&&['127.0.0.1','localhost','::1'].includes(opt?.host)){state.loopbackConnections++;return originalConnect.apply(this,args);} return deny(); }; tls.connect = deny; http2.connect = deny; globalThis.fetch = deny;
  net.Server.prototype.listen = function (...args) { const opt=typeof args[0]==='object'?args[0]:{port:args[0],host:typeof args[1]==='string'?args[1]:undefined}; if(!['127.0.0.1','localhost','::1'].includes(opt?.host)) {state.failure='BIND_HOST';throw Error('OFFLINE_BIND_BLOCKED');} this.once('listening',()=>{const address=this.address();ownedPorts.add(address.port);state.ownedListeners++;});return originalListen.apply(this,args); };
  const childDeny = (...args) => { state.childAttempts++; state.childCalls.push({ command: String(args[0]).slice(0,256).replace(/eyJ[A-Za-z0-9_.-]+/g,'[JWT]'), args: Array.isArray(args[1]) ? args[1].slice(0,12).map(v=>String(v).slice(0,160).replace(/eyJ[A-Za-z0-9_.-]+/g,'[JWT]')) : [] }); throw Error('OFFLINE_CHILD_BLOCKED'); };
  for (const key of ['spawnSync','execSync','execFileSync']) cp[key] = childDeny;
  for (const key of ['spawn','exec','execFile','fork']) cp[key] = (...args) => { let error;try{childDeny(...args);}catch(value){error=value;}error.code='EACCES';error.status=1;error.stdout=Buffer.alloc(0);error.stderr=Buffer.alloc(0);const child=new (require('node:events').EventEmitter)();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=()=>true;child.ref=child.unref=()=>child;child.exitCode=1;child.signalCode=null;process.nextTick(()=>{const callback=args.at(-1);if((key==='exec'||key==='execFile')&&typeof callback==='function')callback(error,'','');else if(child.listenerCount('error'))child.emit('error',error);child.stdout.end();child.stderr.end();child.emit('close',1,null);});return child; };
  wt.Worker = class { constructor() { childDeny(); } };
  // No application write reaches disk. Code reads remain native. Directories are
  // confined to the owned HOME/TMP paths created by the parent.
  const privateWrites = process.env.AXIOM_CB_OFFLINE_PRIVATE_WRITES === '1';
  const canWrite = (name,args) => privateWrites&&allowed(String(args[0]))&&(!/rename|copyFile/.test(name)||allowed(String(args[1])));
  for (const name of ['writeFileSync','appendFileSync','renameSync','copyFileSync']) { const original=fs[name].bind(fs);fs[name] = (path,...args) => { if(canWrite(name,[path,...args]))return original(path,...args);state.writesSuppressed++; }; }
  for (const name of ['writeFile','appendFile','rename','copyFile']) { const original=fs[name].bind(fs);fs[name] = (...args) => { if(canWrite(name,args))return original(...args);state.writesSuppressed++; const cb=args.at(-1); if(typeof cb==='function') queueMicrotask(()=>cb(null)); }; }
  for (const name of ['writeFile','appendFile','rename','copyFile']) { const original=fs.promises[name].bind(fs.promises);fs.promises[name] = async (...args) => {if(canWrite(name,args))return original(...args);state.writesSuppressed++; }; }
  const isWrite = flags => typeof flags === 'number' ? !!(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR)) : /[wa+]/.test(flags);
  fs.openSync = (path, flags, mode) => { if(isWrite(flags)&&!(privateWrites&&allowed(String(path)))) { state.writesSuppressed++; return originalOpenSync('/dev/null','w'); } return originalOpenSync(path,flags,mode); };
  const originalOpen = fs.open.bind(fs), originalPromiseOpen = fs.promises.open.bind(fs.promises);
  fs.open = (path, flags, ...rest) => { if(isWrite(flags)&&!(privateWrites&&allowed(String(path)))) { state.writesSuppressed++; return originalOpen('/dev/null','w',rest.at(-1)); } return originalOpen(path,flags,...rest); };
  fs.promises.open = (path, flags, mode) => { if(isWrite(flags)&&!(privateWrites&&allowed(String(path)))) { state.writesSuppressed++; return originalPromiseOpen('/dev/null','w'); } return originalPromiseOpen(path,flags,mode); };
  const originalStream = fs.createWriteStream.bind(fs);
  fs.createWriteStream = (path, options) => { if(privateWrites&&allowed(String(path)))return originalStream(path,options);state.writesSuppressed++; return originalStream('/dev/null',options); };
  const allowed = path => typeof path === 'string' && [process.env.HOME, process.env.TMPDIR].some(root => root && (path===root || path.startsWith(root+'/')));
  for (const name of ['mkdirSync','rmSync','rmdirSync','unlinkSync']) { const original=fs[name].bind(fs); fs[name]=(path,...args)=> { if(!allowed(String(path))) throw Error('OFFLINE_PATH_BLOCKED'); return original(path,...args); }; }
  for (const name of ['mkdir','rm','rmdir','unlink']) { const original=fs[name].bind(fs); fs[name]=(path,...args)=> { if(!allowed(String(path))) { const cb=args.at(-1); if(typeof cb==='function') return queueMicrotask(()=>cb(Error('OFFLINE_PATH_BLOCKED'))); throw Error('OFFLINE_PATH_BLOCKED'); } return original(path,...args); }; const promise=fs.promises[name].bind(fs.promises); fs.promises[name]=async(path,...args)=> { if(!allowed(String(path))) throw Error('OFFLINE_PATH_BLOCKED'); return promise(path,...args); }; }
  const pathClass = path => path === '/v2/chat/completions' ? 'model' : path === '/v3/config' ? 'catalog' : path === '/v2/plugin/accounts' ? 'accounts' : 'other';
  function request(input, options, callback) {
    if(typeof options === 'function') { callback=options; options=undefined; }
    let base={}; if(typeof input==='string' || input instanceof URL) { const u=new URL(input);base={protocol:u.protocol,hostname:u.hostname,port:u.port,path:u.pathname+u.search}; } else base=input ?? {};
    const config={...base,...options}, headers=Object.fromEntries(Object.entries(config.headers??{}).map(([k,v])=>[k.toLowerCase(),v]));
    const path=String(config.path??'/'), kind=pathClass(path.split('?')[0]);
    const pathname=path.split('?')[0];
    const projection={kind,hostAllowed:(config.hostname??config.host)==='copilot.tencent.com',method:config.method??'GET',offlinePath:/^\/[A-Za-z0-9_./-]{0,180}$/.test(pathname)?pathname:'other',offlineHost:/^[A-Za-z0-9.-]{1,180}$/.test(String(config.hostname??config.host))?String(config.hostname??config.host):'other'};
    if(state.requests.length>=12) { state.failure='REQUEST_BUDGET'; throw Error('REQUEST_BUDGET'); }
    state.requests.push(projection);
    if(['127.0.0.1','localhost','::1'].includes(String(config.hostname??config.host)) && ownedPorts.has(Number(config.port)) && path.split('?')[0]==='/internal/agent') {projection.kind='owned-local-agent';projection.callbackPresent=typeof callback==='function';const local=originalHttpRequest(config,callback);local.on('response',response=>{projection.localStatus=response.statusCode;const emit=response.emit;let text='';response.emit=function(name,...args){if(name==='data'){text+=String(args[0]);projection.localResponseBytes=(projection.localResponseBytes??0)+args[0].length;projection.localMarker=text.includes(marker);if(text.length>8192)text=text.slice(-4096);}if(name==='end')projection.localResponseEnded=true;return emit.call(this,name,...args);};});return local;}
    let chunks=[],size=0,ended=false;
    const req=new Writable({write(chunk,encoding,cb){size+=chunk.length;if(size>1048576){state.failure='REQUEST_LIMIT';return cb(Error('REQUEST_LIMIT'));} chunks.push(Buffer.from(chunk));cb();},final(cb){
      ended=true; const raw=Buffer.concat(chunks); chunks=[]; projection.bytes=raw.length;
      const encoding=String(headers['content-encoding']??''); projection.contentEncoding=['gzip','deflate','br',''].includes(encoding)?encoding:'other';
      let decoded=raw;try { const zlib=require('node:zlib'); if(encoding==='gzip')decoded=zlib.gunzipSync(raw,{maxOutputLength:1048576});else if(encoding==='deflate')decoded=zlib.inflateSync(raw,{maxOutputLength:1048576});else if(encoding==='br')decoded=zlib.brotliDecompressSync(raw,{maxOutputLength:1048576});}catch{projection.decodeFailed=true;}
      const body=decoded.toString('utf8');
      if(kind==='model') { let parsed;try{parsed=JSON.parse(body);}catch{} projection.jsonObject=!!parsed&&typeof parsed==='object';projection.topKeys=parsed&&typeof parsed==='object'?Object.keys(parsed).filter(k=>/^[A-Za-z0-9_]{1,50}$/.test(k)):[];projection.bodyStartsWithJson=['{','['].includes(body.trim()[0]);projection.modelMatches=parsed?.model===model;projection.off=parsed?.reasoning_effort==='none'; projection.stream=parsed?.stream===true;
        projection.tools=Array.isArray(parsed?.tools)?parsed.tools.length:0;projection.roles=Array.isArray(parsed?.messages)?parsed.messages.map(m=>['system','user','assistant','tool'].includes(m.role)?m.role:'other'):[];
        projection.promptPresent=JSON.stringify(parsed?.messages??[]).includes(marker);projection.maxTokens=Number.isSafeInteger(parsed?.max_tokens)?parsed.max_tokens:null;
        const ua=String(headers['user-agent']??'');projection.userAgent=/^[\w .\/-]{0,160}$/.test(ua)?ua:'other';
      }
      const res=new PassThrough();res.statusCode=200;res.statusMessage='OK';res.headers={'content-type':kind==='model'?'text/event-stream':'application/json'};res.rawHeaders=['Content-Type',res.headers['content-type']];res.complete=false;res.req=req;
      let response;
      if(kind==='model') { const chunk=(delta,finish_reason)=>({id:'chatcmpl-synthetic',object:'chat.completion.chunk',created:1700000000,model,choices:[{index:0,delta,finish_reason}]}); response=[chunk({role:'assistant',content:''},null),chunk({content:marker},null),chunk({},'stop'),{id:'chatcmpl-synthetic',object:'chat.completion.chunk',created:1700000000,model,choices:[],usage:{prompt_tokens:20,completion_tokens:8,total_tokens:28}}].map(value=>'data: '+JSON.stringify(value)+'\n\n').join('')+'data: [DONE]\n\n'; }
      else if(kind==='accounts') response=JSON.stringify({code:0,data:{accounts:[{uid:'synthetic-test',nickname:'synthetic',type:'personal'}]}});
      else response=JSON.stringify({code:0,data:{models:[],availableModels:[]}});
      const emit=res.emit;res.emit=function(name,...args){if(name==='end')projection.responseEnded=true;if(name==='error')projection.responseError=true;return emit.call(this,name,...args);};
      queueMicrotask(()=>{projection.responseDelivered=req.emit('response',res);setTimeout(()=>{res.end(response);res.complete=true;},25);setTimeout(()=>{projection.responseListeners={data:res.listenerCount('data'),readable:res.listenerCount('readable'),end:res.listenerCount('end')};},10).unref();});cb();
    }});
    req.setHeader=(key,value)=>{headers[key.toLowerCase()]=value;return req;};req.getHeader=key=>headers[key.toLowerCase()];req.getHeaders=()=>({...headers});req.removeHeader=key=>delete headers[key.toLowerCase()];req.hasHeader=key=>key.toLowerCase() in headers;
    req.setTimeout=(_ms,fn)=>{if(fn)req.on('timeout',fn);return req;};req.setNoDelay=req.setSocketKeepAlive=()=>req;req.flushHeaders=()=>{};req.abort=()=>req.destroy();
    if(callback)req.on('response',callback);return req;
  }
  http.request=https.request=request;http.get=https.get=(...args)=>{const req=request(...args);req.end();return req;};http.ClientRequest=class{constructor(...args){return request(...args);}};
  syncBuiltinESMExports();
  const report = code => {try{originalWriteSync(4,JSON.stringify({...state,exitCode:code,headlessLoaded:Object.keys(require.cache).some(path=>path.endsWith('/dist/codebuddy-headless.js'))})+'\n');}catch{}};
  const heartbeat=setInterval(()=>report(null),5000);heartbeat.unref();
  process.on('exit',report);
  globalThis[Symbol.for('axiom.codebuddy.offline.guard')] = {state,ownedPorts,originalHttpRequest,originalClientRequest};
}
