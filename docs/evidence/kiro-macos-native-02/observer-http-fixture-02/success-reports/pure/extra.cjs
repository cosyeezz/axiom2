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

function bounded(tap,events,cap){
 const s=tap.status();assert.ok(s.pendingBodyBytes>=0);assert.ok(s.bodyBytes>=0);assert.ok(s.bodyBytes+s.pendingBodyBytes<=cap,JSON.stringify(s));
 let total=0;for(const e of events){if(Object.hasOwn(e,'bodyBase64')){const b=Buffer.from(e.bodyBase64,'base64');assert.equal(b.toString('base64'),e.bodyBase64);assert.equal(b.length,e.bytes);total+=b.length;}}
 assert.ok(total<=cap);return {s,total};
}
function terminal(tap,events,cap,exact=true){const {s,total}=bounded(tap,events,cap);assert.equal(s.pendingBodyBytes,0);if(exact)assert.equal(total,s.bodyBytes);console.log('TERMINAL '+JSON.stringify({s,actualBase64Bytes:total}));tap.uninstall();}
for(const outer of ['write','end'])for(const inner of ['write','end'])test('nested returns identity '+outer+' -> '+inner,()=>{
 const outside={},inside={},events=[];let depth=0,tap;const hooks={};
 for(const k of ['write','end'])hooks[k]=function(){bounded(tap,events,5);if(depth){assert.equal(tap.status().pendingBodyBytes,5);return inside;}assert.equal(tap.status().pendingBodyBytes,3);depth++;assert.equal(this[inner]('XY'),inside);depth--;const s=tap.status();assert.equal(s.pendingBodyBytes,3);assert.equal(s.bodyBytes,2);bounded(tap,events,5);return outside;};
 const f=fake(hooks);tap=install(f,e=>{events.push(e);if(tap)bounded(tap,events,5);},{bodyBytes:5});assert.equal(f.req[outer]('abc'),outside);assert.equal(f.calls.length,2);assert.equal(tap.status().ok,true);terminal(tap,events,5);
});
for(const inner of ['write','end'])test('caught nested throw releases reservation '+inner,()=>{
 const thrown={},outerReturn={},events=[];let depth=0,tap;const hooks={};
 for(const k of ['write','end'])hooks[k]=function(){bounded(tap,events,5);if(depth)throw thrown;depth++;assert.throws(()=>this[inner]('XY'),e=>e===thrown);depth--;assert.equal(tap.status().pendingBodyBytes,3);assert.equal(tap.status().bodyBytes,0);return outerReturn;};
 const f=fake(hooks);tap=install(f,e=>events.push(e),{bodyBytes:5});assert.equal(f.req.write('abc'),outerReturn);assert.equal(tap.status().bodyBytes,3);depth=1;assert.throws(()=>f.req[inner]('XY'),e=>e===thrown);depth=0;assert.equal(tap.status().pendingBodyBytes,0);terminal(tap,events,5);
});
for(const outer of ['write','end'])test('outer throw rollback preserves nested commit '+outer,()=>{
 const thrown={},innerReturn={},events=[];let depth=0,tap;const hooks={};
 for(const k of ['write','end'])hooks[k]=function(){bounded(tap,events,5);if(depth)return innerReturn;depth++;assert.equal(this.end('XY'),innerReturn);depth--;assert.equal(tap.status().pendingBodyBytes,3);throw thrown;};
 const f=fake(hooks);tap=install(f,e=>events.push(e),{bodyBytes:5});assert.throws(()=>f.req[outer]('abc'),e=>e===thrown);assert.equal(tap.status().bodyBytes,2);assert.equal(tap.status().pendingBodyBytes,0);
 depth=1;assert.equal(f.req.write('abc'),innerReturn);depth=0;assert.equal(tap.status().bodyBytes,5);assert.equal(tap.status().ok,true);terminal(tap,events,5);
});
for(const outer of ['write','end'])test('original reentry overflow bounded and sticky '+outer,()=>{
 const events=[],ret={};let depth=0,tap;const hooks={};
 for(const k of ['write','end'])hooks[k]=function(){bounded(tap,events,4);if(depth){assert.equal(tap.status().reason,'body-cap');return ret;}assert.equal(tap.status().pendingBodyBytes,4);depth++;assert.equal(this.end('BBBB'),ret);depth--;return ret;};
 const f=fake(hooks);tap=install(f,e=>events.push(e),{bodyBytes:4});assert.equal(f.req[outer]('AAAA'),ret);assert.equal(tap.status().bodyBytes,4);assert.equal(tap.status().reason,'body-cap');const n=events.length;depth=1;assert.equal(f.req.write('C'),ret);depth=0;assert.equal(events.length,n);terminal(tap,events,4,false);
});
test('sink nested cap sticky and original identity',()=>{
 const ret={},events=[];let tap,armed=false,nested=false;const f=fake({write(){return ret;}});
 tap=install(f,e=>{events.push(e);if(armed&&!nested){nested=true;assert.equal(f.req.write('BBBB'),ret);}}, {bodyBytes:4});
 f.http.request({});armed=true;assert.equal(f.req.write('AAAA'),ret);assert.equal(tap.status().reason,'body-cap');const s=tap.status(),n=events.length;f.req.end('q');assert.deepEqual(tap.status(),s);assert.equal(events.length,n);terminal(tap,events,4);
});
test('event log and throwing sink faults sticky at pending boundaries',()=>{
 for(const mode of ['event','log','sink']){const events=[],ret={},error={};let tap,armed=false;const f=fake({write(){bounded(tap,events,4);return ret;}});
 const opts=mode==='event'?{bodyBytes:4,events:2}:mode==='log'?{bodyBytes:4,logBytes:1}:{bodyBytes:4};
 tap=install(f,e=>{events.push(e);if(armed&&mode==='sink')throw error;},opts);f.http.request({});armed=true;assert.equal(f.req.write('AAAA'),ret);assert.equal(tap.status().reason,mode==='sink'?'observer-sink-failed':'event-or-log-cap');const s=tap.status(),n=events.length;assert.equal(f.req.write('B'),ret);assert.equal(events.length,n);assert.deepEqual(tap.status(),s);terminal(tap,events,4,mode==='sink');}
});
test('actual event bytes base64 totals and terminal pending zero mixed inputs',()=>{
 const events=[],f=fake();let tap;tap=install(f,e=>events.push(e),{bodyBytes:16});
 for(const args of [['é','utf8'],[Buffer.from([0,255])],[new Uint8Array([1,2,3])],['é','latin1']])f.req.write(...args);f.req.end();
 const {s,total}=bounded(tap,events,16);assert.equal(total,8);assert.equal(s.events,events.length);assert.equal(s.logBytes,events.reduce((n,e)=>n+Buffer.byteLength(JSON.stringify(e))+1,0));assert.equal(s.ok,true);terminal(tap,events,16);
});
console.log(JSON.stringify({group:'extra',passed,failed:failures.length,failures,version:process.version,platform:process.platform,arch:process.arch}));
process.exitCode=failures.length?1:0;
