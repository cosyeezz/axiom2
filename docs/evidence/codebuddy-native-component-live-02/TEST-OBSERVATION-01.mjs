// Independent offline observation tests. Does not run HARNESS main/selftest/live.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Socket } from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const dir = dirname(fileURLToPath(import.meta.url));
const old = { fetch: globalThis.fetch, connect: Socket.prototype.connect, tls: tls.connect, read: fs.readFileSync };
let networkAttempts = 0, authReadAttempts = 0;
const deny = () => { networkAttempts++; throw Error('OFFLINE_NETWORK_BLOCKED'); };
globalThis.fetch = deny; Socket.prototype.connect = deny; tls.connect = deny;
fs.readFileSync = function(path, ...args) {
  if (/(?:^|[/\\])(?:auth|settings|models)\.json$/.test(String(path))) { authReadAttempts++; throw Error('AUTH_CONFIG_READ_BLOCKED'); }
  return old.read.call(this, path, ...args);
};
syncBuiltinESMExports();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const encode = value => new TextEncoder().encode(value);
const packet = delta => `data: ${JSON.stringify({model:'deepseek-v4.1-flash',choices:[{index:0,delta,finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`;
const results = []; let proof;
async function test(name, run) {
  try { const evidence = await run(); results.push({name, passed:true, ...evidence}); }
  catch (error) { results.push({name, passed:false, failure:error.code === 'ERR_ASSERTION' ? 'ASSERTION_FAILED' : 'TEST_ERROR', ...(error.code === 'ERR_ASSERTION' && ['string','number','boolean'].includes(typeof error.actual) ? {actual:error.actual,expected:error.expected} : {})}); }
}
try {
  const { boundedResponse, newState, binding } = await import('./HARNESS.mjs');
  const project = (await import('./STREAM-PROJECTION.cjs')).default;
  proof = binding();
  proof.observationSHA256 = hash(fs.readFileSync(fileURLToPath(import.meta.url)));
  const manifest = JSON.parse(fs.readFileSync(join(dir,'FROZEN-RUNTIME.json'),'utf8'));
  proof.frozenFileCount = manifest.files.length; proof.frozenArtifactCount = manifest.artifacts.length;
  const {createCodeBuddyClient} = await import(pathToFileURL(join(proof.runtimeRoot,'app/dist/native-providers/codebuddy/client.js')).href);
  const {codeBuddyBuiltinModels} = await import(pathToFileURL(join(proof.runtimeRoot,'app/dist/native-providers/codebuddy/models.js')).href);
  const wrap = body => { const state = newState(); const response = boundedResponse(new Response(body),state,0,new AbortController().signal); return {state,response}; };
  const final = state => { assert.equal(state.activeBodies,0); assert.equal(state.activeCancels,0); };
  await test('concurrent-pull-consumer-cancel-intent-latched-before-await', async () => {
    let pulls=0,cancels=0; const pulling=deferred(), cleanup=deferred();
    const {state,response} = wrap(new ReadableStream({pull(){pulls++;pulling.resolve();},cancel(){cancels++;return cleanup.promise;}},{highWaterMark:0}));
    const reader=response.body.getReader(), pending=reader.read(); await pulling.promise;
    const cancelling=reader.cancel();
    // Must be visible before upstream cancellation promise settles.
    assert.equal(state.responses[0]?.exit,'consumer-cancel'); assert.equal(state.activeCancels,1);
    assert.equal(state.activeBodies,0); await tick(); assert.equal(state.activeCancels,1);
    cleanup.resolve(); await Promise.all([pending,cancelling]); final(state);
    assert.equal(state.responses[0].exit,'consumer-cancel'); assert.equal(cancels,1);
    return {pulls,cancels,latchedBeforeUpstreamSettled:true};
  });
  await test('real-eof-not-consumer-cancel', async () => {
    let cancels=0; const bytes=encode(packet({content:'SAFE'}));
    const {state,response}=wrap(new ReadableStream({start(c){c.enqueue(bytes);c.close();},cancel(){cancels++;}}));
    await response.arrayBuffer(); final(state); assert.equal(state.responses[0].exit,'eof'); assert.equal(state.responses[0].done,true); assert.equal(cancels,0);
    return {exit:state.responses[0].exit,done:true,cancels};
  });
  await test('upstream-error-is-error-not-eof-and-no-raw-error', async () => {
    let source; const {state,response}=wrap(new ReadableStream({start(c){source=c;}}));
    const reading=response.arrayBuffer(); source.enqueue(encode(packet({content:'SAFE'}))); await tick(); source.error(Error('OBS_UPSTREAM_PRIVATE_SENTINEL'));
    await assert.rejects(reading); final(state); assert.equal(state.responses[0].exit,'error'); assert.equal(state.responses[0].done,true);
    assert.equal(JSON.stringify(state.responses).includes('OBS_UPSTREAM_PRIVATE_SENTINEL'),false);
    return {exit:state.responses[0].exit,done:true};
  });
  await test('DONE-then-consumer-cancel-never-promoted-to-eof', async () => {
    const cleanup=deferred();let cancels=0;
    const {state,response}=wrap(new ReadableStream({start(c){c.enqueue(encode(packet({content:'SAFE'})));},cancel(){cancels++;return cleanup.promise;}}));
    const reader=response.body.getReader();await reader.read(); const cancelling=reader.cancel();
    assert.equal(state.responses[0].exit,'consumer-cancel');assert.equal(state.responses[0].done,true);assert.equal(state.activeCancels,1);
    await tick();assert.equal(state.activeCancels,1);cleanup.resolve();await cancelling;final(state);
    assert.equal(cancels,1);return {exit:state.responses[0].exit,done:true,cancels};
  });
  await test('limit-error-then-concurrent-cancel-retains-first-intent-and-pending-counter',async()=>{
    const cleanup=deferred(),started=deferred();let cancels=0;
    const {state,response}=wrap(new ReadableStream({start(c){c.enqueue(new Uint8Array(65537));},cancel(){cancels++;started.resolve();return cleanup.promise;}}));
    const reader=response.body.getReader();const reading=reader.read();await started.promise;
    assert.equal(state.responses[0].exit,'error');assert.equal(state.activeCancels,1);
    const cancelling=reader.cancel();await tick();assert.equal(state.responses[0].exit,'error');assert.ok(state.activeCancels>0);
    cleanup.resolve();await Promise.allSettled([reading,cancelling]);final(state);assert.equal(cancels,1);
    return {exit:state.responses[0].exit,cancels};
  });
  await test('legacy-modern-tool-projection-types-only-no-sentinels',async()=>{
    const sentinel='OBS_PRIVATE_SENTINEL_7F40';
    const delta={content:sentinel,reasoning_content:sentinel,refusal:sentinel,function_call:{name:sentinel,arguments:sentinel,[sentinel]:sentinel},tool_calls:[{index:0,id:sentinel,type:sentinel,function:{name:sentinel,arguments:sentinel,[sentinel]:sentinel}}]};
    const projection=project(Buffer.from(packet(delta)),'consumer-cancel');const choice=projection.frames[0].choices[0];
    assert.deepEqual(choice.legacy,{shape:'object',nameShape:'string',argumentsShape:'string',unknownKeys:true});
    assert.equal(choice.tools[0].nameShape,'string');assert.equal(choice.tools[0].argumentsShape,'string');assert.equal(JSON.stringify(projection).includes(sentinel),false);
    const empty=project(Buffer.from(packet({function_call:{name:'',arguments:null}})),'eof').frames[0].choices[0].legacy;
    assert.equal(empty.nameShape,'empty-string');assert.equal(empty.argumentsShape,'null');
    return {sentinelAbsent:true,legacy:choice.legacy,empty};
  });
  const model=codeBuddyBuiltinModels().find(m=>m.id==='deepseek-v4.1-flash');
  const context={systemPrompt:'Synthetic policy',messages:[{role:'user',content:'Synthetic fixture'}]};
  async function core(legacy) {
    const client=createCodeBuddyClient(async()=>new Response(packet({content:'SAFE',function_call:legacy}),{headers:{'content-type':'text/event-stream'}}));
    const events=[];try{for await(const e of client.stream({model,access:'SYNTHETIC',context,options:{reasoning:'off'}}))events.push(e);}finally{client.dispose();}return events;
  }
  await test('frozen-core-empty-legacy-only-safe-boundary',async()=>{
    const allowed=[undefined,null,{}, {name:'',arguments:''},{name:null,arguments:null},{name:''},{arguments:null}];
    const forbidden=[{name:'OBS_PRIVATE_NAME_SENTINEL',arguments:''},{arguments:'OBS_PRIVATE_ARGS_SENTINEL'},{extra:null},{name:false},{arguments:0},[],false,0,''];
    for(const legacy of allowed){const events=await core(legacy);assert.equal(events.at(-1).type,'done');assert.equal(events.some(e=>e.type.startsWith('tool-')),false);}
    for(const legacy of forbidden){const events=await core(legacy);assert.equal(events.at(-1).type,'error');assert.equal(events.some(e=>e.type==='done'||e.type==='tool-end'),false);const diag=events.filter(e=>e.type==='diagnostic'||e.type==='error');assert.equal(JSON.stringify(diag).includes('OBS_PRIVATE_'),false);}
    return {allowed:allowed.length,rejected:forbidden.length,diagnosticsSentinelAbsent:true};
  });
  await test('network-and-auth-config-untouched',async()=>{assert.equal(networkAttempts,0);assert.equal(authReadAttempts,0);return {networkAttempts,authReadAttempts};});
} catch { results.push({name:'setup-or-binding',passed:false,failure:'SETUP_OR_BINDING_FAILED'}); }
finally {globalThis.fetch=old.fetch;Socket.prototype.connect=old.connect;tls.connect=old.tls;fs.readFileSync=old.read;syncBuiltinESMExports();}
const result={passed:results.length>0&&results.every(r=>r.passed),offline:true,networkAttempts,authReadAttempts,binding:proof,tests:results};
fs.writeFileSync(join(dir,'observation-test-01.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({passed:result.passed,tests:results,binding:{snapshotManifestSHA256:proof?.snapshotManifestSHA256,harnessSHA256:proof?.harnessSHA256,observationSHA256:proof?.observationSHA256,frozenFileCount:proof?.frozenFileCount,frozenArtifactCount:proof?.frozenArtifactCount}}));
if(!result.passed)process.exitCode=1;
