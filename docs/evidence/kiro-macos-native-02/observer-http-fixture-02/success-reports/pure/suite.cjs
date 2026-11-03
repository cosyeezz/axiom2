 'use strict';
const assert=require('node:assert/strict');
const Module=require('node:module');
const target=process.argv[2], group=process.argv[3];
const load=Module._load, imports=[];
Module._load=function(name,...args){imports.push(name);if(/^(node:)?(fs|http|https|net|tls|child_process)$/.test(name))throw Error('unexpected pure import '+name);return Reflect.apply(load,this,[name,...args]);};
let exported;
try {exported=require(target);} finally {Module._load=load;}
assert.equal(exported.automaticStatus(),null);
assert.deepEqual(imports,[target]);
const {install}=exported;
let passed=0, failures=[];
function test(name,fn){try{fn();passed++;console.log('PASS '+name);}catch(e){failures.push(name);console.log('FAIL '+name+'\n'+e.stack);}}
function fake(hooks={}){
 const calls=[];
 function ClientRequest(){this.method='POST';this.path='/owned';this._header='H\r\n';}
 const req=new ClientRequest();
 function record(kind,self,args){calls.push({kind,self,args:Array.from(args)});if(hooks[kind])return Reflect.apply(hooks[kind],self,args);return kind==='write'?false:kind==='header'?headerReturn:req;}
 const headerReturn={header:true};
 ClientRequest.prototype.write=function write(chunk,encoding,callback){return record('write',this,arguments);};
 ClientRequest.prototype.end=function end(chunk,encoding,callback){return record('end',this,arguments);};
 ClientRequest.prototype._storeHeader=function _storeHeader(first,headers){return record('header',this,arguments);};
 const http={ClientRequest,request:function request(options,callback){return record('http',this,arguments);}};
 const https={request:function request(options,callback){return record('https',this,arguments);}};
 return {http,https,req,calls,headerReturn};
}
function sameCall(c,self,args){assert.equal(c.self,self);assert.equal(c.args.length,args.length);args.forEach((v,i)=>assert.equal(c.args[i],v));}
function descriptors(f){return [Object.getOwnPropertyDescriptors(f.http),Object.getOwnPropertyDescriptors(f.https),Object.getOwnPropertyDescriptors(f.http.ClientRequest.prototype)];}
if(group==='core'){
 test('pure require no automatic guard/imports',()=>assert.equal(exported.automaticStatus(),null));
 test('original receiver arguments arity once return and callback identities',()=>{
  let callbacks=0;const cb=()=>callbacks++;const f=fake({write:function(...args){if(typeof args.at(-1)==='function')args.at(-1)();return false;}});const before=descriptors(f);const events=[];const tap=install(f,e=>events.push(e));
  const obj={opaque:true}, receiver={receiver:true};
  for(const library of [f.http,f.https]){for(const args of [[],[obj],[obj,cb],[obj,cb,undefined,obj]]){const n=f.calls.length;assert.equal(Reflect.apply(library.request,receiver,args),f.req);assert.equal(f.calls.length,n+1);sameCall(f.calls.at(-1),receiver,args);}}
  for(const args of [['x'],['x','utf8',cb],['x',cb],['x','utf8',cb,obj]]){const n=f.calls.length;assert.equal(Reflect.apply(f.req.write,f.req,args),false);assert.equal(f.calls.length,n+1);sameCall(f.calls.at(-1),f.req,args);}
  assert.equal(callbacks,2);
  for(const args of [[],[cb],['',cb],['x','latin1',cb,obj]]){const n=f.calls.length;assert.equal(Reflect.apply(f.req.end,f.req,args),f.req);assert.equal(f.calls.length,n+1);sameCall(f.calls.at(-1),f.req,args);}
  assert.equal(f.req._storeHeader(obj,cb),f.headerReturn);sameCall(f.calls.at(-1),f.req,[obj,cb]);
  assert.equal(tap.status().ok,true);tap.uninstall();assert.deepEqual(descriptors(f),before);tap.uninstall();assert.deepEqual(descriptors(f),before);
 });
 test('original thrown object unchanged all APIs, no callback on reject',()=>{
  for(const kind of ['http','https','write','end','header']){const thrown={kind};let cbN=0;const f=fake({[kind]:()=>{throw thrown;}});const tap=install(f,()=>{});const owner=kind==='http'?f.http:kind==='https'?f.https:f.req;const method=kind==='http'||kind==='https'?'request':kind==='header'?'_storeHeader':kind;const cb=()=>cbN++;assert.throws(()=>owner[method]('x',cb),e=>e===thrown);assert.equal(f.calls.length,1);assert.equal(cbN,0);assert.equal(tap.status().bodyBytes,0);tap.uninstall();}
 });
 test('input option getters only original reads',()=>{
  let reads=0;const options={get method(){reads++;return 'POST';},get path(){reads++;return '/x';}};const f=fake({http:function(o){assert.equal(o,options);this.seen=[o.method,o.path];return f.req;}});const tap=install(f,()=>{});assert.equal(f.http.request(options),f.req);assert.equal(reads,2);tap.uninstall();
 });
 test('lexical aliases names lengths inherited descriptors duplicate install restoration',()=>{
  const f=fake();const proto=f.http.ClientRequest.prototype;const write=proto.write;const inherited=Object.create(null);Object.defineProperty(inherited,'request',{value:f.https.request,enumerable:true,writable:false,configurable:true});f.https=Object.create(inherited);
  Object.defineProperty(f.http,'request',{value:f.http.request,writable:false,enumerable:false,configurable:true});const before=descriptors(f),old=f.http.request;const tap=install(f,()=>{});assert.equal(f.http.request.name,old.name);assert.equal(f.http.request.length,old.length);assert.equal(proto.write.length,write.length);assert.notEqual(f.http.request,old);assert.equal(old.call(f.http,{}),f.req);assert.equal(tap.status().requests,0);assert.throws(()=>install(f,()=>{}),/already installed/);tap.uninstall();assert.deepEqual(descriptors(f),before);assert.equal(Object.hasOwn(f.https,'request'),false);assert.equal(proto.write,write);
 });
 test('failed install rolls back original descriptors',()=>{const f=fake();f.http.ClientRequest.prototype.end=null;const before=descriptors(f);assert.throws(()=>install(f,()=>{}),/unsupported API/);assert.deepEqual(descriptors(f),before);});
 test('header metadata getter exception does not replace original return or throw',()=>{
  for(const field of ['method','path','_header']){const f=fake();Object.defineProperty(f.req,field,{get(){throw {metadata:field};}});const tap=install(f,()=>{});assert.equal(f.req._storeHeader('X',{}),f.headerReturn);assert.equal(tap.status().ok,false);assert.equal(f.calls.length,1);tap.uninstall();}
  const original={original:true};const f=fake({header(){throw original;}});Object.defineProperty(f.req,'_header',{get(){throw Error('must not read');}});const tap=install(f,()=>{});assert.throws(()=>f.req._storeHeader(),e=>e===original);tap.uninstall();
 });
}
if(group==='chunks'){
 test('Buffer Uint8Array offset utf8 latin1 empty bytes exact',()=>{
  const events=[],f=fake(),tap=install(f,e=>events.push(e));const backing=new Uint8Array([99,0,255,100]);
  const cases=[[Buffer.from([0,255]),undefined,Buffer.from([0,255])],[backing.subarray(1,3),undefined,Buffer.from([0,255])],['é🙂','utf8',Buffer.from('é🙂')],['é','latin1',Buffer.from([233])],['','utf8',Buffer.alloc(0)],[Buffer.alloc(0),undefined,Buffer.alloc(0)]];
  for(const [v,enc,want] of cases){const n=f.calls.length;assert.equal(f.req.write(v,enc),false);assert.equal(f.calls.length,n+1);const e=events.at(-1);assert.equal(e.kind,'write');assert.equal(e.bodyBase64,want.toString('base64'));assert.equal(e.bytes,want.length);}
  for(const args of [[],[null],[undefined],[()=>{}]])assert.equal(Reflect.apply(f.req.end,f.req,args),f.req);
  assert.equal(tap.status().bodyBytes,11);assert.equal(tap.status().ok,true);tap.uninstall();
 });
 test('invalid returned chunks fail closed; rejecting originals keep error identity',()=>{
  for(const bad of [{},12,new DataView(new ArrayBuffer(2)),new Uint16Array(2)]){const f=fake(),tap=install(f,()=>{});assert.equal(f.req.write(bad),false);assert.equal(tap.status().reason,'unrecordable-returned-input');tap.uninstall();}
  const error={invalid:true},f=fake({write(){throw error;}}),tap=install(f,()=>{});assert.throws(()=>f.req.write({}),e=>e===error);assert.equal(tap.status().ok,true);tap.uninstall();
 });
 test('invalid string encoding that fake accepts becomes unrecordable',()=>{const f=fake(),tap=install(f,()=>{});assert.equal(f.req.write('x','not-an-encoding'),false);assert.equal(tap.status().reason,'unrecordable-returned-input');tap.uninstall();});
}
if(group==='caps'){
 test('body cap boundary sticky counters no more sink, original still runs',()=>{const f=fake(),events=[],tap=install(f,e=>events.push(e),{bodyBytes:3});f.req.write('abc');assert.equal(tap.status().bodyBytes,3);f.req.write('x');assert.equal(tap.status().reason,'body-cap');const s=tap.status();f.req.end('q');f.req._storeHeader();f.http.request({});assert.deepEqual({...tap.status(),requests:s.requests},s);assert.equal(f.calls.length,5);tap.uninstall();});
 test('event cap and log cap bound and sticky',()=>{for(const limits of [{events:1},{logBytes:1}]){let n=0;const f=fake(),tap=install(f,()=>n++,limits);assert.equal(f.http.request({}),f.req);assert.equal(tap.status().reason,'event-or-log-cap');assert.ok(tap.status().events<=(limits.events||128));assert.ok(tap.status().logBytes<=(limits.logBytes||1048576));const s=tap.status();f.req.write('xx');f.req.end();assert.deepEqual(tap.status(),s);tap.uninstall();}});
 test('sink throwing object swallowed sticky first reason monotonic counters detached status',()=>{const error={sink:true},f=fake();let count=0;const tap=install(f,()=>{count++;throw error;});assert.equal(f.http.request({}),f.req);const s=tap.status();assert.equal(s.reason,'observer-sink-failed');f.req.write('x');f.req.end('y');assert.equal(count,1);assert.deepEqual(tap.status(),s);s.ok=true;s.events=-1;assert.equal(tap.status().ok,false);assert.equal(tap.status().events,1);tap.uninstall();});
 test('limits reject nonpositive fractional unsafe values',()=>{for(const n of [0,-1,1.1,NaN,Infinity,2**53]){const f=fake();assert.throws(()=>install(f,()=>{},{bodyBytes:n}),TypeError);}});
}
if(group==='audit'){
 test('AUDIT reentrant write must not exceed cumulative body cap',()=>{
  const events=[];let nested=false;const f=fake({write:function(){if(!nested){nested=true;assert.equal(this.write('BBBB'),false);}return false;}});const tap=install(f,e=>events.push(e),{bodyBytes:4});assert.equal(f.req.write('AAAA'),false);const state=tap.status();console.log('REENTRANT_EVIDENCE '+JSON.stringify({state,events,calls:f.calls.length}));tap.uninstall();assert.ok(state.bodyBytes<=4,'bodyBytes '+state.bodyBytes+' exceeds configured cap 4');assert.equal(state.ok,false,'cap overflow must fail closed');
 });
 test('AUDIT sink reentry must not exceed body cap',()=>{let nested=false;const events=[],f=fake();const tap=install(f,e=>{events.push(e);if(e.kind==='request'&&!nested){nested=true;f.req.write('BBBB');}},{bodyBytes:4});f.req.write('AAAA');const s=tap.status();console.log('SINK_REENTRY_EVIDENCE '+JSON.stringify({state:s,events}));tap.uninstall();assert.ok(s.bodyBytes<=4);assert.equal(s.ok,false);});
 test('AUDIT throwing header getter original callback args receiver still preserved',()=>{const f=fake({header:function(...args){args[1]();return f.headerReturn;}});const error={getter:true};let reads=0,cb=0;Object.defineProperty(f.req,'_header',{get(){reads++;throw error;}});const tap=install(f,()=>{});const arg={},callback=()=>cb++;assert.equal(f.req._storeHeader(arg,callback),f.headerReturn);sameCall(f.calls[0],f.req,[arg,callback]);assert.equal(cb,1);assert.equal(reads,1);assert.equal(tap.status().reason,'observer-header-failed');tap.uninstall();});
}
console.log(JSON.stringify({group,passed,failed:failures.length,failures,version:process.version,platform:process.platform,arch:process.arch}));
process.exitCode=failures.length?1:0;
