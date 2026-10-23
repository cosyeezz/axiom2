import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { EventEmitter } from "node:events";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { ExecutionPool, type ExecutionLease, type PoolLimits } from "../src/server/execution-pool.js";
import type { PreparedEnvironment, ExecutionMode } from "../src/server/execution-profile.js";

function harness(t: TestContext, max = 3, limits: Partial<PoolLimits> = {}, mode: ExecutionMode = "managed") {
  const children: any[] = [];
  const pool = new ExecutionPool({ maxLiveProcesses:max, maxIdleRetained:max, targetReadyTotal:0, nestedLeafReserve:1, ...limits }, mode);
  const mock=t.mock.method(childProcess,"fork",((_path:any,_args:any,options:any)=>{
    const child:any=Object.assign(new EventEmitter(),{connected:true,exitCode:null,signalCode:null,stderr:undefined,messages:[],
      send(value:any,callback?:(error?:Error)=>void){child.messages.push(value);callback?.();return true;},
      kill(){child.close();return true;},
      close(){if(child.exitCode!==null)return;child.exitCode=0;child.connected=false;child.emit('close',0,null);}});
    children.push(child);
    queueMicrotask(()=>child.emit('message',{type:'process_ready',instance:{instanceId:options.env.AXIOM_EXECUTION_INSTANCE,generation:Number(options.env.AXIOM_EXECUTION_GENERATION),profileHash:options.env.AXIOM_EXECUTION_PROFILE}}));
    return child;
  }) as typeof childProcess.fork);
  syncBuiltinESMExports();
  t.after(async()=>{for(const child of children)child.close();await pool.close();mock.mock.restore();syncBuiltinESMExports();});
  let refs=0;const references=new Map<string,number>();
  const environment=(key='same',reuse:PreparedEnvironment['reuse']='cross-binding'):PreparedEnvironment=>({
    profileHash:key,entry:'memory',reuse,cwd:process.cwd(),root:process.cwd(),modelDir:process.cwd(),modelsFile:'fixture.json',workerPath:'fixture.js',execArgv:[],env:{},environmentWarm:false,configRevision:'1',
    current:()=>true,snapshotValid:()=>true,retain:()=>{refs++;references.set(key,(references.get(key)??0)+1);},release:()=>{refs--;references.set(key,(references.get(key)??0)-1);},
  });
  const acquire=(key='same',extra:Record<string,unknown>={})=>pool.acquire({environment:environment(key),kind:'agent',signal:new AbortController().signal,requestStartedAtMonoMs:performance.now(),...extra});
  const cleaned=async(lease:ExecutionLease,keepSession=false,sessionId='session')=>{
    const child=await lease.ensureReady();child.emit('message',{type:'cleaned',lease:lease.ref});
    await pool.release(lease.ref,{clean:true,keepSession,...(keepSession?{affinity:{sessionId,fileRevision:'1'}}:{})});
  };
  return {pool,children,environment,acquire,cleaned,refs:(key?:string)=>key===undefined?refs:references.get(key)??0};
}
const turn=()=>new Promise(resolve=>setImmediate(resolve));

test('idle retirement stops prewarming after the last real demand expires',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:10000});
  const h=harness(t,3,{targetReadyTotal:1,idleTtlMs:1000,maxLifetimeMs:10000},'D');
  const lease=await h.acquire();await lease.ensureReady();await h.pool.waitForPrewarm();await h.cleaned(lease);
  assert.equal(h.pool.stats().created,2);
  t.mock.timers.tick(1000);
  assert.equal(h.pool.stats().retiring,2);
  for(const child of h.children)child.close();
  await turn();
  assert.equal(h.pool.stats().total,0);assert.equal(h.refs(),0);
  t.mock.timers.tick(3000);await h.pool.waitForPrewarm();await turn();
  assert.equal(h.pool.stats().created,2);assert.equal(h.children.length,2);
});

for(const age of [999,1000])test(`prewarming observes the exact last-demand TTL boundary at ${age}ms`,async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:10000});
  const h=harness(t,3,{targetReadyTotal:1,idleTtlMs:1000,maxLifetimeMs:10000},'D');
  const lease=await h.acquire();await h.pool.retire(lease.ref,'uncommitted');
  t.mock.timers.tick(age);await h.pool.waitForPrewarm();
  assert.equal(h.pool.stats().created,age<1000?1:0);
  assert.equal(h.refs(),age<1000?2:0);
  if(age===999){
    t.mock.timers.tick(1);await h.pool.waitForPrewarm();
    assert.equal(h.pool.stats().created,1);assert.equal(h.refs(),1,'prewarming did not renew real demand');
    t.mock.timers.tick(999);h.children[0].close();await turn();
    assert.equal(h.pool.stats().created,1);assert.equal(h.refs(),0);
  }
});

test('real demand renews prewarm eligibility across instance lifetimes without interrupting an active lease',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:10000});
  const h=harness(t,3,{targetReadyTotal:1,idleTtlMs:1000,maxLifetimeMs:400},'D');
  const first=await h.acquire();await h.cleaned(first);
  t.mock.timers.tick(400);h.children[0].close();await h.pool.waitForPrewarm();
  assert.equal(h.pool.stats().created,2);
  t.mock.timers.tick(300);
  const second=await h.acquire();assert.notEqual(second.ref.instanceId,first.ref.instanceId);await h.cleaned(second);
  t.mock.timers.tick(100);h.children[1].close();await h.pool.waitForPrewarm();
  assert.equal(h.pool.stats().created,3);
  t.mock.timers.tick(200);
  const active=await h.acquire();const child:any=await active.ensureReady();
  t.mock.timers.tick(1000);await h.pool.waitForPrewarm();
  assert.equal(h.pool.isActive(active.ref),true);
  assert.equal(child.messages.some((message:any)=>message.type==='shutdown'),false);
  assert.equal(h.pool.stats().created,3);assert.equal(h.refs(),1,'only the active instance retains the expired profile');
  const cleaning=h.cleaned(active);await turn();
  assert.equal(h.pool.stats().retiring,1);child.close();await cleaning;
  assert.equal(h.refs(),0);
});

test('recent-profile LRU and demand expiry release exactly their own references',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:10000});
  const h=harness(t,3,{idleTtlMs:1000},'D');
  const demand=async(key:string)=>{const lease=await h.acquire(key);await h.pool.retire(lease.ref,'uncommitted');};
  for(let i=0;i<8;i++)await demand(String(i));
  assert.equal(h.refs(),8);
  t.mock.timers.tick(900);await demand('0');await demand('8');assert.equal(h.refs(),8);
  assert.equal(h.refs('1'),0);assert.equal(h.refs('0'),1);assert.equal(h.refs('8'),1);
  t.mock.timers.tick(100);await h.pool.waitForPrewarm();assert.equal(h.refs(),2);
  t.mock.timers.tick(900);await h.pool.waitForPrewarm();assert.equal(h.refs(),0);
  await h.pool.trim();await h.pool.close();assert.equal(h.refs(),0);
});

test('binding completion revalidates configuration and snapshot before permitting inference', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const h=harness(t);let valid=true,kills=0;
  (h.pool as any).kill=()=>{kills++;};
  const environment={...h.environment(),current:()=>valid};
  const first=await h.acquire('same',{environment});const child:any=await first.ensureReady();
  child.emit('message',{type:'binding_ready',lease:{...first.ref,leaseId:'old'}});
  assert.equal(child.messages.some((m:any)=>m.type==='execution_permit'),false);
  valid=false;
  child.emit('message',{type:'binding_ready',lease:first.ref});
  await turn();
  assert.equal(child.messages.find((m:any)=>m.type==='execution_permit')?.allowed,false);
  assert.equal(child.messages.some((m:any)=>m.type==='shutdown'),false,'the denied run owns failure reporting and cleanup');
  assert.equal(h.pool.isActive(first.ref),false,'rejection revokes the lease before the worker closes');
  assert.equal(h.pool.stats().total,1,'rejection still holds physical capacity until close');
  t.mock.timers.tick(19999);assert.equal(kills,0);
  t.mock.timers.tick(1);assert.equal(kills,1,'a denied worker that does not close is still force-stopped');
  assert.equal(h.pool.stats().total,1,'initiating forced termination does not release capacity');
  child.close();await first.released;
  const snapshot={...h.environment(),snapshotValid:()=>false};
  const second=await h.acquire('same',{environment:snapshot});
  await assert.rejects(second.ensureReady(),{code:'REVISION_CONFLICT'});
});

for(const transition of ['cancel','reuse'] as const)test(`late async resource verification cannot permit the old lease after ${transition}`,async t=>{
  const h=harness(t),controller=new AbortController();let complete!:(valid:boolean)=>void;
  const environment={...h.environment(),currentAsync:()=>new Promise<boolean>(resolve=>{complete=resolve;})};
  const lease=await h.acquire('same',{environment,signal:controller.signal}),child:any=await lease.ensureReady();
  child.emit('message',{type:'binding_ready',lease:lease.ref});
  assert.equal(typeof complete,'function');
  if(transition==='cancel'){controller.abort();child.close();await lease.released;}
  else{await h.cleaned(lease);const successor=await h.acquire('same',{environment});assert.equal(successor.ref.instanceId,lease.ref.instanceId);assert.notEqual(successor.ref.leaseId,lease.ref.leaseId);}
  complete(true);await turn();
  assert.equal(child.messages.some((message:any)=>message.type==='execution_permit'),false);
});

test('pool close waits for cancelled asynchronous resource reads to settle',async t=>{
  const h=harness(t);let complete!:(valid:boolean)=>void;
  const environment={...h.environment(),currentAsync:()=>new Promise<boolean>(resolve=>{complete=resolve;})};
  const lease=await h.acquire('same',{environment}),child:any=await lease.ensureReady();
  child.emit('message',{type:'binding_ready',lease:lease.ref});
  let closed=false;const closing=h.pool.close().then(()=>{closed=true;});child.close();await turn();
  assert.equal(closed,false);complete(false);await closing;assert.equal(closed,true);
});

test('unspawned reservations cancel without forking; old ensureReady and repeated retirement cannot resurrect them',async t=>{
  const h=harness(t),controller=new AbortController();
  const lease=await h.acquire('same',{signal:controller.signal});
  assert.equal(h.pool.stats().reserved,1);assert.equal(h.children.length,0);
  controller.abort();await lease.released;
  await assert.rejects(lease.ensureReady(),{code:'AGENT_STOPPED'});
  await h.pool.retire(lease.ref,'duplicate');assert.equal(h.pool.stats().total,0);assert.equal(h.children.length,0);
});

test('ensureReady is single flight; a result alone cannot return a worker, stale cleanup cannot release a new lease',async t=>{
  const h=harness(t),first=await h.acquire();
  const one=first.ensureReady(),two=first.ensureReady();assert.equal(one,two);const child=await one;
  assert.equal(h.children.length,1);child.emit('message',{type:'completed',lease:first.ref});
  await assert.rejects(h.pool.release(first.ref,{clean:true,keepSession:false}),/cleanup/);
  assert.equal(h.pool.stats().leased,1);
  await h.cleaned(first);
  const second=await h.acquire();assert.equal(second.ref.instanceId,first.ref.instanceId);assert.notEqual(second.ref.leaseId,first.ref.leaseId);
  child.emit('message',{type:'cleaned',lease:first.ref});
  await h.pool.release(first.ref,{clean:true,keepSession:false});
  await h.pool.retire(first.ref,'old_cancel');assert.equal(h.pool.isActive(second.ref),true);
  await assert.rejects(h.pool.release(second.ref,{clean:true,keepSession:false}),/cleanup/);
  await h.cleaned(second);
});

test('retiring processes retain physical capacity and incompatible idle owners are evicted without waiting for TTL',async t=>{
  const h=harness(t,2);
  const a=await h.acquire('a');await h.cleaned(a);
  const b=await h.acquire('b');await h.cleaned(b);
  let granted=false;const waiting=h.acquire('c').then(lease=>{granted=true;return lease;});
  await turn();assert.equal(granted,false);assert.equal(h.pool.stats().total,2);assert.equal(h.pool.stats().retiring,1);
  const victim=h.children.find(child=>child.messages.some((m:any)=>m.type==='shutdown'));assert.ok(victim);
  victim.close();const c=await waiting;assert.equal(h.pool.stats().total,2);assert.equal(h.pool.stats().reserved,1);
  await h.pool.retire(c.ref,'not_committed');assert.ok(h.pool.stats().peak<=2);
});

test('forced retirement rejects late cleanup and keeps capacity until physical close', async t => {
  const h = harness(t, 2), first = await h.acquire();
  const child: any = await first.ensureReady();
  let kills = 0;
  (h.pool as any).kill = () => { kills++; }; // OS termination has started but close is delayed.
  const retired = h.pool.retire(first.ref, 'done_timeout', true);
  assert.equal(kills, 1);
  assert.equal(h.pool.isActive(first.ref), false);
  child.emit('message', { type: 'cleaned', lease: first.ref });
  const lateRelease = h.pool.release(first.ref, { clean: true, keepSession: false }).catch(() => {});
  let granted = false;
  const pending = h.acquire().then(lease => { granted = true; return lease; });
  await turn();
  assert.equal(granted, false);
  assert.equal(h.pool.stats().retiring, 1);
  assert.equal(h.pool.stats().total, 1);
  child.close(); await retired; await lateRelease;
  const second = await pending;
  assert.notEqual(second.ref.instanceId, first.ref.instanceId);
  // 此用例替换了 pool.kill 以模拟强制终止尚未发出 OS close；第二个
  // mock child 同样必须显式关闭，容量只会在真实 close 后释放。
  const secondChild: any = await second.ensureReady();
  const secondRetired = h.pool.retire(second.ref, 'not_committed');
  secondChild.close(); await secondRetired;
  assert.equal(h.pool.stats().total, 0);
  // profile snapshot 的保留引用属于 pool 生命周期，由 close() 统一释放。
  await h.pool.close();
  assert.equal(h.refs(), 0);
});

test('environment cleanup failure cannot interrupt close observers or retirement', async t => {
  const h = harness(t), base = h.environment();
  let failCleanup = false;
  const environment = { ...base, release() {
    base.release();
    if (failCleanup) { failCleanup = false; throw Error('fixture snapshot deletion failure'); }
  } };
  const lease = await h.acquire('same', { environment });
  const child: any = await lease.ensureReady();
  let observedClose = 0;
  child.on('close', () => { observedClose++; });
  const retired = h.pool.retire(lease.ref, 'cleanup_failure');
  failCleanup = true;
  assert.doesNotThrow(() => child.close());
  await retired;
  assert.equal(observedClose, 1);
  assert.equal(h.pool.stats().total, 0);
  await h.pool.close();
  assert.equal(h.refs(), 0);
});

test('joint memory admission skips an ordinary waiter so a live parent can use the leaf reserve',async t=>{
  const h=harness(t,3),parent=await h.acquire('parent'),other=await h.acquire('other');
  const backgroundController=new AbortController();let backgroundStarted=false;
  const background=h.acquire('memory',{kind:'memory-organize',memory:{concurrency:1,queue:4},signal:backgroundController.signal}).then(lease=>{backgroundStarted=true;return lease;});
  const rejected=assert.rejects(background,/取消/);
  const leaf=await h.acquire('memory',{kind:'memory-query',memory:{concurrency:1,queue:4},parentLease:parent.ref});
  assert.equal(backgroundStarted,false);assert.equal(h.pool.stats().memory,1);assert.equal(h.pool.stats().ordinary,2);assert.equal(h.pool.stats().total,3);
  await assert.rejects(h.acquire('memory',{kind:'memory-query',memory:{concurrency:1,queue:4},parentLease:{...parent.ref,leaseId:'forged'}}),{code:'AGENT_STOPPED'});
  backgroundController.abort();await rejected;await h.pool.retire(leaf.ref,'end');await h.pool.retire(parent.ref,'end');await h.pool.retire(other.ref,'end');
  assert.equal(h.pool.stats().total,0);
});

test('a queued leaf loses eligibility when its real parent ends and close drains all reservations and waiters',async t=>{
  const h=harness(t,2),parent=await h.acquire('parent');
  const leaf=await h.acquire('memory',{kind:'memory-query',parentLease:parent.ref,memory:{concurrency:1,queue:4}});
  const waiting=h.acquire('memory',{kind:'memory-query',parentLease:parent.ref,memory:{concurrency:1,queue:4}});
  const rejected=assert.rejects(waiting,{code:'AGENT_STOPPED'});
  await h.pool.retire(parent.ref,'parent_ended');await rejected;
  await h.pool.close();await leaf.released;
  assert.equal(h.pool.stats().total,0);assert.equal(h.pool.stats().queued,0);assert.equal(h.refs(),0);
});

test('same-session workers cannot cross bindings, and changed file revisions wait for the old writer to close',async t=>{
  const h=harness(t,3),environment=h.environment('agent','same-session');
  const first=await h.acquire('agent',{environment,affinity:{sessionId:'one',fileRevision:'1'}});await h.cleaned(first,true,'one');
  const same=await h.acquire('agent',{environment,affinity:{sessionId:'one',fileRevision:'1'}});assert.equal(same.source,'affinity');await h.cleaned(same,true,'one');
  let granted=false;const next=h.acquire('agent',{environment,affinity:{sessionId:'one',fileRevision:'2'}}).then(lease=>{granted=true;return lease;});
  await turn();assert.equal(granted,false);assert.equal(h.pool.hasAffinity('one'),true);
  h.children[0].close();const changed=await next;assert.notEqual(changed.ref.instanceId,first.ref.instanceId);
  await h.pool.retire(changed.ref,'end');
});

test('expired deadlines never reserve or fork, and preparation timeout retains capacity until close', async t => {
  const h = harness(t);
  await assert.rejects(h.acquire('expired', { deadlineAt: Date.now() - 1 }), { code: 'AGENT_STOPPED' });
  assert.equal(h.pool.stats().total, 0);
  h.pool.limits.prepareTimeoutMs = 20;
  const environment = { ...h.environment(), environmentWarm: true };
  const lease = await h.acquire('same', { environment });
  const ready = lease.ensureReady();
  const rejected = assert.rejects(ready, /超时/);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(h.pool.stats().retiring, 1);
  assert.equal(h.pool.stats().total, 1);
  h.children[0].close();
  await rejected;
  assert.equal(h.pool.stats().total, 0);
});

test('different valid profiles in one directory retain independent idle environments', async t => {
  const h = harness(t);
  const a = await h.acquire('a'); await h.cleaned(a);
  const b = await h.acquire('b'); await h.cleaned(b);
  assert.equal(h.pool.stats().idle, 2);
  assert.equal(h.pool.stats().retiring, 0);
  const again = await h.acquire('a');
  assert.equal(again.ref.instanceId, a.ref.instanceId);
  await h.cleaned(again);
});

test('single-use session writers remain owned throughout retirement before the next binding', async t => {
  const h = harness(t), environment = h.environment('agent', 'single-use');
  const first = await h.acquire('agent', { environment, affinity: { sessionId: 'writer', fileRevision: '1' } });
  const child = await first.ensureReady(); child.emit('message', { type: 'idle', lease: first.ref });
  const release = h.pool.release(first.ref, { clean: true, keepSession: true, affinity: { sessionId: 'writer', fileRevision: '1' } });
  assert.equal(h.pool.hasAffinity('writer'), true);
  let granted = false;
  const next = h.acquire('agent', { environment, affinity: { sessionId: 'writer', fileRevision: '1' } }).then(lease => { granted = true; return lease; });
  await turn(); assert.equal(granted, false);
  child.emit('message', { type: 'closed', lease: first.ref });
  await turn(); assert.equal(granted, false, 'IPC closed is not OS close');
  (child as any).close(); await release;
  const second = await next; assert.notEqual(second.ref.instanceId, first.ref.instanceId);
  await h.pool.retire(second.ref, 'end');
});
