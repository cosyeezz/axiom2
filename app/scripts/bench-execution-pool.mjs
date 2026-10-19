// Local synthetic benchmark only. Every request traverses the production worker, SDK and HTTP.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir, cpus, totalmem, release } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
const args = Object.fromEntries(process.argv.slice(2).map(v => { const [k, ...parts] = v.replace(/^--/, '').split('='); return [k, parts.join('=')]; }));
const source = resolve(args.build || 'dist'), label = args.label || 'D', samples = Number(args.samples || 100), hits = Number(args.hits || 200), batches = Number(args.batches || 3);
const output = resolve(args.output || `test-results/execution-pool/${label}.json`);
mkdirSync(resolve(output, '..'), { recursive: true });
const importServer = file => import(pathToFileURL(join(source, 'server', `${file}.js`)).href);
const { Store } = await importServer('storage'), { ModelService } = await importServer('model-service'), { Agents } = await importServer('agents');
const report = { measurementVersion: 3, arguments: args, probeSha256: createHash('sha256').update(readFileSync(new URL('./execution-bench-probe.mjs',import.meta.url))).digest('hex'), label, source, node: process.version, platform: `${process.platform} ${release()} ${process.arch}`, cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalMemory: totalmem(), generatedAt: new Date().toISOString(), prepareEndpoint: 'mock_received', mode: args.mode || label, samples: [], resources: [], hashes: Object.fromEntries(['agents','agent-worker','memory-worker','memory-runner','compressions'].map(f => [f, createHash('sha256').update(readFileSync(join(source,'server',`${f}.js`))).digest('hex')])), status: 'running' };
const wait = async (check, message) => { const end = Date.now() + 60000; while (!check()) { assert.ok(Date.now() < end, message); await new Promise(r => setTimeout(r, 2)); } };
const quantile = (values, p) => values.length ? [...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1] : null;
const scenarios = (args.scenarios || 'agent-cold,agent-affinity,agent-process,memory,compression').split(',');
const prevOptions = process.env.NODE_OPTIONS;
try {
  for (let batch = 0; batch < batches; batch++) {
    const root = mkdtempSync(join(tmpdir(), 'axiom-pool-bench-')), pi = join(root,'pi'), project = join(root,'project'), probe = join(root,'probe');
    mkdirSync(pi); mkdirSync(project); mkdirSync(probe);
    process.env.AXIOM_PI_DIR = pi; process.env.AXIOM_EXECUTION_MODE = args.mode || (['C','D'].includes(label) ? label : 'managed');
    process.env.AXIOM_BENCH_PROBE = probe;
    process.env.NODE_OPTIONS = `${prevOptions || ''} --import=${pathToFileURL(fileURLToPath(new URL('./execution-bench-probe.mjs', import.meta.url))).href}`;
    let current, failure;
    const http = createServer(async (req,res) => { try { let raw=''; for await(const chunk of req) raw+=chunk;
      const body = JSON.parse(raw); assert.ok(current, 'prewarming must never infer'); current.requests++;
      current.prepareMs ??= performance.now()-current.started;
      res.writeHead(200, {'Content-Type':'text/event-stream'});
      const content = current.scenario === 'compression' ? '## Goal\nSynthetic benchmark.\n## Progress\nComplete.\n<axiom-summary>基准摘要</axiom-summary>' : 'Synthetic benchmark response.';
      res.end(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta:{role:'assistant',content},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}})}\n\ndata: [DONE]\n\n`);
    } catch(e) { failure=e; res.writeHead(500);res.end('fixture'); } });
    await new Promise(r=>http.listen(0,'127.0.0.1',r));
    writeFileSync(join(pi,'models.json'),JSON.stringify({providers:{fixture:{api:'openai-completions',baseUrl:`http://127.0.0.1:${http.address().port}/v1`,models:[{id:'fixture',contextWindow:128000,maxTokens:256}]}}}));
    writeFileSync(join(pi,'auth.json'),JSON.stringify({fixture:{type:'api_key',key:'fixture'}}));
    writeFileSync(join(pi,'settings.json'),JSON.stringify({retry:{enabled:false},compaction:{enabled:false},cacheWarming:'off'}));
    const store = new Store(root), models = new ModelService(root), agents = new Agents(store,models,()=>{});
    const selection = {provider:'fixture',id:'fixture',thinking:'off'};
    const space = store.execute({requestId:randomUUID(),op:'workspace.open',params:{path:project,authorized:true}});
    const create = () => { const session=store.execute({requestId:randomUUID(),op:'session.create',workspaceId:space.id});
      store.db.prepare('INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?) ON CONFLICT(sessionId) DO UPDATE SET selection=excluded.selection').run(session.id,JSON.stringify(selection));
      return {workspaceId:space.id,sessionId:session.id}; };
    const begin = (scenario,index) => current={scenario,index,batch,started:performance.now(),requests:0,status:'running',prepareMs:null,firstOutputMs:null};
    const finish = () => { assert.equal(failure,undefined);assert.ok(current.requests>0,'provider endpoint was not observed');current.totalMs=performance.now()-current.started;current.status='completed';report.samples.push(current);current=undefined; };
    agents.onEvent = (_scope,_run,event) => { if(current && event.type==='message' && event.message?.role==='assistant' && event.message.text) current.firstOutputMs ??= performance.now()-current.started; };
    const metrics = [];
    if(agents.pool) agents.pool.onMetric = value => {
      metrics.push(value);
      if (!current) return;
      if (value.phase === 'acquired') current.acquired = value;
      if (value.phase === 'ready_wait') current.readyWaitMs = value.durationMs;
      if (value.phase === 'execution_phase') (current.phases ??= {})[value.stage] = value.durationMs;
      if (value.phase === 'provider_request') current.prepareHookObservedMs ??= performance.now()-current.started;
    };
    const childrenSnapshot = () => readdirSync(probe).filter(n=>n.endsWith('.json')).flatMap(n=>{try{return [JSON.parse(readFileSync(join(probe,n),'utf8'))];}catch{return [];}});
    let peakWorkerCount=0, peakRssSumBytes=0;
    const resourceSampler=setInterval(()=>{const live=childrenSnapshot().filter(c=>!c.exited&&Date.now()-c.observedAt<1000);peakWorkerCount=Math.max(peakWorkerCount,live.length);peakRssSumBytes=Math.max(peakRssSumBytes,live.reduce((n,c)=>n+c.lastRSS,0));},250);
    const beforeCpu=process.cpuUsage(), beginWindow=performance.now();
    let idlePool, idleResources;
    try {
      for(const scenario of scenarios) {
        const count = scenario==='agent-affinity' || scenario==='agent-process' || (scenario==='memory' && label!=='A' && label!=='B') ? hits : samples;
        let affinity;
        for(let i=0;i<count;i++) {
          if(scenario==='agent-cold') { if(agents.pool) await agents.pool.trim(); }
          if(args.arrival && i) await new Promise(r=>setTimeout(r,Math.max(0, Number(args.arrival) - (performance.now()-(report.samples.at(-1)?.started||0)))));
          if(!args.arrival && agents.pool && ['C','D'].includes(args.mode||label) && i && scenario!=='agent-cold' && scenario!=='agent-affinity') await agents.pool.waitForPrewarm();
          const scope = scenario==='agent-affinity' ? (affinity ??= create()) : create();
          begin(scenario,i);
          if(scenario==='memory') {
            await agents.memories.runner.execute({scope,kind:i%3===1?'organize':'query',selection,prompt:'Synthetic benchmark. Return a short answer.',read:()=>{throw Error('fixture has no candidates');}});
            current.firstOutputMs = performance.now()-current.started; current.firstOutputEndpoint='result_returned';
          }
          else {
            if(scenario==='compression') { begin('seed',i);await agents.command({requestId:randomUUID(),op:'prompt',...scope,params:{text:'Seed the synthetic compression fixture.'}});await wait(()=>!agents.active(scope),'seed settle');await agents.releaseIdle(scope);begin(scenario,i); }
            if(scenario==='compression') { await agents.compressions.command({requestId:randomUUID(),op:'compression.start',...scope,params:{selection}});await wait(()=>agents.compressions.info(scope)?.state!=='running','compression settle');assert.equal(agents.compressions.info(scope)?.state,'completed');current.firstOutputMs=performance.now()-current.started;current.firstOutputEndpoint='result_returned'; }
            else { await agents.command({requestId:randomUUID(),op:'prompt',...scope,params:{text:'Synthetic benchmark. Return a short answer.'}});await wait(()=>!agents.active(scope),'agent settle');assert.equal(agents.info(scope).run?.status,'completed'); }
          }
          finish();
          if(scenario!=='agent-affinity') await agents.releaseIdle(scope);
        }
        if(affinity) await agents.releaseIdle(affinity);
      }
      await agents.pool?.waitForPrewarm();
      idlePool = agents.pool?.stats();
      const idleStart=childrenSnapshot(), idleAt=performance.now();
      await new Promise(resolve=>setTimeout(resolve,1000));
      const idleEnd=childrenSnapshot(), retained=idleEnd.filter(c=>!c.exited && Date.now()-c.observedAt<500);
      idleResources={windowMs:performance.now()-idleAt,workerCount:retained.length,rssSumBytes:retained.reduce((n,c)=>n+c.lastRSS,0),activeNodeHandles:retained.reduce((n,c)=>n+c.activeNodeHandles,0),cpuMs:idleEnd.reduce((n,c)=>n+c.cpuMs-(idleStart.find(p=>p.pid===c.pid)?.cpuMs??0),0),note:'RSS sum includes shared pages; Node handle count is not OS handle count'};
      assert.equal(failure,undefined);
    } finally {
      clearInterval(resourceSampler);
      if(current) report.failedSample={...current,status:'failed'};
      await agents.close();
      const children=childrenSnapshot(), cpu=process.cpuUsage(beforeCpu);
      report.resources.push({batch,peakWorkerCount,peakRssSumBytes,windowMs:performance.now()-beginWindow,parentCpuMs:(cpu.user+cpu.system)/1000,children,childCpuMs:children.reduce((n,c)=>n+c.cpuMs,0),maxChildRssBytes:Math.max(0,...children.map(c=>c.maxRSSBytes)),idlePool,idleResources,finalPool:agents.pool?.stats(),metrics});
      store.close();http.closeAllConnections();await new Promise(r=>http.close(r));rmSync(root,{recursive:true,force:true});
    }
  }
  report.status='completed';
} catch(e) { report.status='failed';report.error=String(e);process.exitCode=1; }
finally { if(prevOptions===undefined) delete process.env.NODE_OPTIONS;else process.env.NODE_OPTIONS=prevOptions;
  report.summary=Object.fromEntries(scenarios.map(s=>{const rows=report.samples.filter(r=>r.scenario===s);return[s,{count:rows.length,prepareP50:quantile(rows.map(r=>r.prepareMs),.5),prepareP95:quantile(rows.map(r=>r.prepareMs),.95),firstOutputP50:quantile(rows.filter(r=>r.firstOutputMs!==null).map(r=>r.firstOutputMs),.5),firstOutputP95:quantile(rows.filter(r=>r.firstOutputMs!==null).map(r=>r.firstOutputMs),.95)}];}));
  writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({output,status:report.status,summary:report.summary,error:report.error})); }
