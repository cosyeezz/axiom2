import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ExecutionPool } from '../src/server/execution-pool.js';
import { ExecutionProfiles } from '../src/server/execution-profile.js';
import { Agents } from '../src/server/agents.js';
import { Store } from '../src/server/storage.js';
import { ModelService } from '../src/server/model-service.js';
import { randomUUID } from 'node:crypto';
import type { Workspace, Session } from '../src/shared/protocol.js';

for (const failure of ['configuration', 'snapshot', 'cancel'] as const) {
  test(`real memory binding gate rejects ${failure} before the first provider request`, { timeout: 20000 }, async () => {
    const root=mkdtempSync(join(tmpdir(),'axiom-binding-gate-')),pi=join(root,'pi'),cwd=join(root,'project');
    mkdirSync(pi);mkdirSync(cwd);
    let requests=0;
    const http=createServer((_req,res)=>{requests++;res.writeHead(500);res.end('inference must not happen');});
    await new Promise<void>(r=>http.listen(0,'127.0.0.1',r));
    const raw=JSON.stringify({providers:{fixture:{api:'openai-completions',baseUrl:`http://127.0.0.1:${(http.address() as any).port}/v1`,models:[{id:'fixture',contextWindow:32000,maxTokens:256}]}}});
    writeFileSync(join(pi,'models.json'),raw);writeFileSync(join(pi,'auth.json'),JSON.stringify({fixture:{type:'api_key',key:'loopback-only'}}));
    const pool=new ExecutionPool({targetReadyTotal:0},'D'),profiles=new ExecutionProfiles(root);
    const environment=profiles.prepare({entry:'memory',cwd,modelDir:pi,modelsRaw:raw,mode:'D'}),controller=new AbortController();
    try {
      const lease=await pool.acquire({environment,kind:'memory-query',signal:controller.signal,requestStartedAtMonoMs:performance.now()});
      const child=await lease.ensureReady();let bound=false;
      const retirement: unknown[]=[];
      pool.onMetric=metric=>{if(metric.phase==='retiring'&&metric.leaseId===lease.ref.leaseId)retirement.push(metric.reason);};
      // The real worker has loaded its runtime and session. Mutate before the coordinator's gate handler.
      child.prependListener('message',(event:any)=>{
        if(event.type!=='binding_ready')return;
        bound=true;
        if(failure==='configuration')writeFileSync(join(pi,'auth.json'),'{}');
        else if(failure==='snapshot')writeFileSync(environment.modelsFile,'{"providers":{}}');
        else controller.abort();
      });
      child.send({type:'start',lease:lease.ref,input:{executionGate:true,root,cwd,modelsFile:environment.modelsFile,selection:{provider:'fixture',id:'fixture',thinking:'off'},prompt:'Must not infer.',readChars:100}});
      await lease.released;
      assert.equal(bound,true,'fault is injected after actual runtime and session preparation');
      assert.equal(requests,0);
      assert.deepEqual(retirement,[failure==='cancel'?'cancelled':'binding_changed'],'coordinator actively rejects this lease');
      assert.equal(pool.stats().total,0,'real close drains the failed lease');
    } finally {
      await pool.close();environment.release();http.closeAllConnections();await new Promise<void>(r=>http.close(()=>r()));rmSync(root,{recursive:true,force:true});
    }
  });
}

for (const failure of ['configuration', 'resource', 'snapshot'] as const) {
  test(`real affinity binding gate rejects ${failure} before a second provider request`, { timeout: 20000 }, async () => {
    const root=mkdtempSync(join(tmpdir(),'axiom-affinity-gate-')),pi=join(root,'pi'),cwd=join(root,'project');
    mkdirSync(pi);mkdirSync(cwd);
    const previousDir=process.env.AXIOM_PI_DIR,previousMode=process.env.AXIOM_EXECUTION_MODE;
    process.env.AXIOM_PI_DIR=pi;process.env.AXIOM_EXECUTION_MODE='managed';
    let requests=0;
    const http=createServer(async(req,res)=>{for await(const _ of req){}requests++;res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta:{role:'assistant',content:'First binding completed.'},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);});
    await new Promise<void>(r=>http.listen(0,'127.0.0.1',r));
    writeFileSync(join(pi,'models.json'),JSON.stringify({providers:{fixture:{api:'openai-completions',baseUrl:`http://127.0.0.1:${(http.address() as any).port}/v1`,models:[{id:'fixture',contextWindow:32000,maxTokens:256}]}}}));
    writeFileSync(join(pi,'auth.json'),JSON.stringify({fixture:{type:'api_key',key:'loopback-only'}}));
    const store=new Store(root),agents=new Agents(store,new ModelService(root),()=>{});
    const acquire=agents.pool.acquire.bind(agents.pool);let borrow=0,firstInstance='',injected=false,retired=false;
    agents.pool.onMetric=m=>{if(m.phase==='retiring'&&m.reason==='binding_changed')retired=true;};
    agents.pool.acquire=async request=>{
      const lease=await acquire(request);borrow++;
      if(borrow===1)firstInstance=lease.ref.instanceId;
      if(borrow===2){
        assert.equal(lease.ref.instanceId,firstInstance,'second request must use the original session process');
        const child=await lease.ensureReady();
        child.prependListener('message',(event:any)=>{
          if(event.type!=='binding_ready')return;
          injected=true;
          if(failure==='configuration')writeFileSync(join(pi,'auth.json'),'{}');
          else if(failure==='resource')writeFileSync(join(cwd,'AGENTS.md'),'Changed after actual session binding.');
          else writeFileSync(lease.environment.modelsFile,'{"providers":{}}');
        });
      }
      return lease;
    };
    const wait=async(check:()=>boolean)=>{const until=Date.now()+12000;while(!check()){assert.ok(Date.now()<until,'binding must settle without the 30-second permit timeout');await new Promise(r=>setTimeout(r,5));}};
    try{
      const workspace=store.execute({requestId:randomUUID(),op:'workspace.open',params:{path:cwd,authorized:true}}) as Workspace;
      const session=store.execute({requestId:randomUUID(),op:'session.create',workspaceId:workspace.id}) as Session;
      const scope={workspaceId:workspace.id,sessionId:session.id};
      store.db.prepare('INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?)').run(session.id,JSON.stringify({provider:'fixture',id:'fixture',thinking:'off'}));
      await agents.command({requestId:randomUUID(),op:'prompt',...scope,params:{text:'First request.'}});
      await wait(()=>!agents.active(scope));assert.equal(agents.info(scope).run?.status,'completed');assert.equal(requests,1);
      await agents.command({requestId:randomUUID(),op:'prompt',...scope,params:{text:'Must not infer after changed binding.'}});
      await wait(()=>!agents.active(scope)&&agents.pool.stats().total===0);
      assert.equal(injected,true);assert.equal(retired,true);assert.equal(requests,1);assert.equal(agents.info(scope).run?.status,'failed');
    }finally{
      await agents.close();store.close();http.closeAllConnections();await new Promise<void>(r=>http.close(()=>r()));
      if(previousDir===undefined)delete process.env.AXIOM_PI_DIR;else process.env.AXIOM_PI_DIR=previousDir;
      if(previousMode===undefined)delete process.env.AXIOM_EXECUTION_MODE;else process.env.AXIOM_EXECUTION_MODE=previousMode;
      rmSync(root,{recursive:true,force:true});
    }
  });
}

test('resource changes after ready reject cold binding before extension startup', { timeout: 20000 }, async () => {
  const root=mkdtempSync(join(tmpdir(),'axiom-prebind-gate-')),pi=join(root,'pi'),cwd=join(root,'project'),marker=join(root,'extension-started');
  mkdirSync(pi);mkdirSync(cwd);
  const previousDir=process.env.AXIOM_PI_DIR,previousMode=process.env.AXIOM_EXECUTION_MODE;
  process.env.AXIOM_PI_DIR=pi;process.env.AXIOM_EXECUTION_MODE='managed';
  let requests=0;
  const http=createServer((_req,res)=>{requests++;res.writeHead(500);res.end('must not infer');});
  await new Promise<void>(r=>http.listen(0,'127.0.0.1',r));
  writeFileSync(join(pi,'models.json'),JSON.stringify({providers:{fixture:{api:'openai-completions',baseUrl:`http://127.0.0.1:${(http.address() as any).port}/v1`,models:[{id:'fixture',contextWindow:32000,maxTokens:256}]}}}));
  writeFileSync(join(pi,'auth.json'),JSON.stringify({fixture:{type:'api_key',key:'loopback-only'}}));
  const store=new Store(root),agents=new Agents(store,new ModelService(root),()=>{}),acquire=agents.pool.acquire.bind(agents.pool);
  let injected=false;
  agents.pool.acquire=async request=>{
    const lease=await acquire(request),ready=lease.ensureReady.bind(lease);
    lease.ensureReady=async()=>{
      const child=await ready();
      mkdirSync(join(cwd,'.pi','extensions'),{recursive:true});
      writeFileSync(join(cwd,'.pi','extensions','changed.ts'),`import { writeFileSync } from 'node:fs';\nexport default function(pi) { pi.on('session_start', () => { writeFileSync(${JSON.stringify(marker)}, 'started'); void pi.sendUserMessage('Must not reach the provider.'); }); }\n`);
      injected=true;return child;
    };
    return lease;
  };
  try{
    const workspace=store.execute({requestId:randomUUID(),op:'workspace.open',params:{path:cwd,authorized:true}}) as Workspace;
    const session=store.execute({requestId:randomUUID(),op:'session.create',workspaceId:workspace.id}) as Session;
    const scope={workspaceId:workspace.id,sessionId:session.id};
    store.db.prepare('INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?)').run(session.id,JSON.stringify({provider:'fixture',id:'fixture',thinking:'off'}));
    await assert.rejects(agents.command({requestId:randomUUID(),op:'prompt',...scope,params:{text:'Must reject before binding.'}}),{code:'WORKER_START_FAILED',message:/配置或资源已变化/});
    assert.equal(injected,true);assert.equal(existsSync(marker),false);assert.equal(requests,0);assert.equal(agents.pool.stats().total,0);
  }finally{
    await agents.close();store.close();http.closeAllConnections();await new Promise<void>(r=>http.close(()=>r()));
    if(previousDir===undefined)delete process.env.AXIOM_PI_DIR;else process.env.AXIOM_PI_DIR=previousDir;
    if(previousMode===undefined)delete process.env.AXIOM_EXECUTION_MODE;else process.env.AXIOM_EXECUTION_MODE=previousMode;
    rmSync(root,{recursive:true,force:true});
  }
});
