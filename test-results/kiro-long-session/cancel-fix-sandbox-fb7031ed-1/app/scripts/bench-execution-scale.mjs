// Small trend fixtures, not a percentile release gate. Production workers and local HTTP only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { SessionManager } from '@earendil-works/pi-coding-agent';
const args=Object.fromEntries(process.argv.slice(2).map(v=>{const[k,...rest]=v.replace(/^--/,'').split('=');return[k,rest.join('=')];}));
const build=resolve(args.build||'dist'),label=args.label||'D',output=resolve(args.output||`test-results/execution-pool/${label}-scale.json`);
const mode=args.mode||(['C','D'].includes(label)?label:'managed');
assert.ok(['managed','C','D'].includes(mode));
const load=name=>import(pathToFileURL(join(build,'server',`${name}.js`)).href);
const {Store}=await load('storage'),{ModelService}=await load('model-service'),{Agents}=await load('agents');
const previousNodeOptions=process.env.NODE_OPTIONS;
process.env.NODE_OPTIONS=`${previousNodeOptions||''} --import=${new URL('./execution-bench-probe.mjs',import.meta.url).href}`;
const report={kind:'scale-trend',label,mode,build,probeSha256:createHash('sha256').update(readFileSync(new URL('./execution-bench-probe.mjs',import.meta.url))).digest('hex'),node:process.version,prepareEndpoint:'mock_received',status:'running',fixtures:[],hashes:Object.fromEntries(['agents','agent-worker'].map(n=>[n,createHash('sha256').update(readFileSync(join(build,'server',`${n}.js`))).digest('hex')]))};
const fixtures=args.smoke?[{historyMiB:0.05,resources:5}]:[{historyMiB:0.5,resources:0},{historyMiB:5,resources:0},{historyMiB:50,resources:0},{historyMiB:0,resources:50},{historyMiB:0,resources:500},{historyMiB:0,resources:2000}];
try{for(const spec of fixtures){
  const root=mkdtempSync(join(tmpdir(),'axiom-scale-')),pi=join(root,'pi'),cwd=join(root,'project'),probe=join(root,'probe');mkdirSync(pi);mkdirSync(cwd);mkdirSync(probe);
  process.env.AXIOM_BENCH_PROBE=probe;
  process.env.AXIOM_PI_DIR=pi;process.env.AXIOM_EXECUTION_MODE=mode;
  let fixtureResourcesBytes=0;const fixtureResourceSizeCounts={};
  for(let i=0;i<spec.resources;i++){const path=join(cwd,'.pi','skills',`fixture-${i}`);mkdirSync(path,{recursive:true});const content=`---\nname: fixture-${i}\ndescription: Synthetic benchmark resource ${i}.\n---\nRead-only synthetic fixture.\n`;writeFileSync(join(path,'SKILL.md'),content);const size=Buffer.byteLength(content);fixtureResourcesBytes+=size;fixtureResourceSizeCounts[size]=(fixtureResourceSizeCounts[size]||0)+1;}
  let current,failure;
  const http=createServer(async(req,res)=>{try{let raw='';for await(const c of req)raw+=c;JSON.parse(raw);assert.ok(current);current.requests++;current.prepareMs??=performance.now()-current.started;current.requestBytes=Buffer.byteLength(raw);res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta:{role:'assistant',content:'Synthetic benchmark response.'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}})}\n\ndata: [DONE]\n\n`);}catch(e){failure=String(e);res.writeHead(500);res.end('fixture');}});
  const row={...spec,fixtureResourcesBytes,fixtureResourceSizeCounts,samples:[]};report.fixtures.push(row);
  let store,agents,sampler;
  const cpuStart=process.cpuUsage(),windowStart=performance.now();let peakRssSumBytes=0,peakWorkerCount=0;
  const children=(strict=false)=>{try{return readdirSync(probe).filter(n=>n.endsWith('.json')).flatMap(n=>{try{const c=JSON.parse(readFileSync(join(probe,n),'utf8'));assert.ok(['pid','cpuMs','lastRSS','maxRSSBytes'].every(k=>Number.isFinite(c[k])&&c[k]>=0));return[c];}catch(error){if(strict)(row.resourceErrors??=[]).push(`${n}: ${error}`);return[];}});}catch(error){(row.resourceErrors??=[]).push(String(error));return[];}};
  try {
  await new Promise(r=>http.listen(0,'127.0.0.1',r));
  writeFileSync(join(pi,'models.json'),JSON.stringify({providers:{fixture:{api:'openai-completions',baseUrl:`http://127.0.0.1:${http.address().port}/v1`,models:[{id:'fixture',contextWindow:100000000,maxTokens:256}]}}}));
  writeFileSync(join(pi,'auth.json'),JSON.stringify({fixture:{type:'api_key',key:'fixture'}}));writeFileSync(join(pi,'settings.json'),JSON.stringify({retry:{enabled:false},compaction:{enabled:false},cacheWarming:'off'}));
  store=new Store(root);const models=new ModelService(root);agents=new Agents(store,models,()=>{});const selection={provider:'fixture',id:'fixture',thinking:'off'};
  const space=store.execute({requestId:randomUUID(),op:'workspace.open',params:{path:cwd,authorized:true}}),session=store.execute({requestId:randomUUID(),op:'session.create',workspaceId:space.id}),scope={workspaceId:space.id,sessionId:session.id};
  const manager=SessionManager.create(cwd,root),text='Synthetic history evidence. '.repeat(600);let bytes=0;
  while(bytes<spec.historyMiB*1024*1024){manager.appendMessage({role:'user',content:text,timestamp:Date.now()});bytes+=Buffer.byteLength(text);}
  manager.appendMessage({role:'assistant',content:[{type:'text',text:'Seeded fixture.'}],api:'openai-completions',provider:'fixture',model:'fixture',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()});
  const file=manager.getSessionFile();store.db.prepare('INSERT INTO agent_sessions(sessionId,selection,file) VALUES(?,?,?)').run(session.id,JSON.stringify(selection),file);
  Object.assign(row,{poolLimits:agents.pool?.limits,actualMode:agents.pool?.mode??'baseline',jsonlBytes:statSync(file).size,jsonlLines:readFileSync(file,'utf8').trim().split('\n').length,contentBytes:bytes});
  agents.onEvent=(_scope,_run,event)=>{if(current&&event.type==='message'&&event.message?.role==='assistant'&&event.message.text)current.firstOutputMs??=performance.now()-current.started;};
  if(agents.pool)agents.pool.onMetric=metric=>{if(current&&metric.phase==='acquired')current.acquired=metric;};
  sampler=setInterval(()=>{const live=children().filter(c=>!c.exited&&Date.now()-c.observedAt<1000);peakWorkerCount=Math.max(peakWorkerCount,live.length);peakRssSumBytes=Math.max(peakRssSumBytes,live.reduce((n,c)=>n+c.lastRSS,0));},250);
  for(let i=0;i<4;i++){
    current={index:i,started:performance.now(),requests:0,status:'running'};row.samples.push(current);
    try{
      await agents.command({requestId:randomUUID(),op:'prompt',...scope,params:{text:'Synthetic benchmark. Return a short answer.'}});
      const until=Date.now()+120000;while(agents.active(scope)){assert.ok(Date.now()<until,'agent settlement timeout');await new Promise(r=>setTimeout(r,5));}
      const info=agents.info(scope);current.runError=info.run?.error;current.loadedFixtureSkills=info.environment?.skills.filter(name=>name.startsWith('fixture-')).length;
      assert.equal(info.run?.status,'completed');assert.equal(failure,undefined);assert.ok(current.requests);assert.equal(current.loadedFixtureSkills,spec.resources);current.status='completed';
    }catch(error){current.status='failed';current.error=String(error);current.fixtureError=failure;current.runError=agents.info(scope).run?.error;throw error;}
    finally{current.totalMs=performance.now()-current.started;}
    current=undefined;
  }}catch(error){row.error=String(error);throw error;}finally{
    clearInterval(sampler);const cleanupErrors=[];
    try{await agents?.close();}catch(error){cleanupErrors.push(String(error));}
    row.finalPool=agents?.pool?.stats();const usage=process.cpuUsage(cpuStart),workers=children(true);
    if(row.samples.length&&(!workers.length||(row.finalPool&&workers.length!==row.finalPool.created)))(row.resourceErrors??=[]).push('Worker probe coverage does not match created processes');
    row.resourceUsage={valid:!row.resourceErrors?.length,windowMs:performance.now()-windowStart,parentCpuMs:(usage.user+usage.system)/1000,childCpuMs:row.resourceErrors?.length?null:workers.reduce((n,c)=>n+c.cpuMs,0),peakWorkerCount,peakRssSumBytes,workers};
    try{store?.close();}catch(error){cleanupErrors.push(String(error));}
    try{http.closeAllConnections();await new Promise(r=>http.close(r));}catch(error){cleanupErrors.push(String(error));}
    try{rmSync(root,{recursive:true,force:true});}catch(error){cleanupErrors.push(String(error));}
    row.cleanupErrors=cleanupErrors;
  }
  assert.equal(row.resourceErrors?.length??0,0);assert.equal(row.cleanupErrors.length,0);
}report.status='completed';}catch(error){report.status='failed';report.error=String(error);process.exitCode=1;}
finally{if(previousNodeOptions===undefined)delete process.env.NODE_OPTIONS;else process.env.NODE_OPTIONS=previousNodeOptions;mkdirSync(resolve(output,'..'),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({output,status:report.status,error:report.error}));}
