// Fixed schedule: requests are launched independently of completion and pool readiness.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
const args=Object.fromEntries(process.argv.slice(2).map(v=>{const [key,...rest]=v.replace(/^--/,'').split('=');return[key,rest.join('=')];}));
const build=resolve(args.build||'dist'),mode=args.mode||'D',scenario=args.scenario||'memory',count=Number(args.samples||100),interval=Number(args.interval||250);
const output=resolve(args.output||`test-results/execution-pool/${mode}-arrival.json`);
assert.ok(['memory','agent-process'].includes(scenario));assert.ok(count>0&&interval>0);
const load=name=>import(pathToFileURL(join(build,'server',`${name}.js`)).href);
const {Store}=await load('storage'),{ModelService}=await load('model-service'),{Agents}=await load('agents');
const root=mkdtempSync(join(tmpdir(),'axiom-arrival-')),pi=join(root,'pi'),cwd=join(root,'project'),probe=join(root,'probe');
for(const p of [pi,cwd,probe])mkdirSync(p);
process.env.AXIOM_PI_DIR=pi;process.env.AXIOM_EXECUTION_MODE=mode;process.env.AXIOM_BENCH_PROBE=probe;
process.env.NODE_OPTIONS=`${process.env.NODE_OPTIONS||''} --import=${new URL('./execution-bench-probe.mjs',import.meta.url).href}`;
const report={measurementVersion:3,probeSha256:createHash('sha256').update(readFileSync(new URL('./execution-bench-probe.mjs',import.meta.url))).digest('hex'),kind:'fixed-arrival',build,mode,scenario,count,interval,node:process.version,prepareEndpoint:'mock_received',status:'running',samples:[],metrics:[],hashes:Object.fromEntries(['agents','execution-pool','agent-worker','memory-worker'].map(name=>[name,createHash('sha256').update(readFileSync(join(build,'server',`${name}.js`))).digest('hex')]))};
const byId=new Map(),byScope=new Map();let fixtureFailure;
const http=createServer(async(req,res)=>{try{
  let text='';for await(const chunk of req)text+=chunk;
  const ids=[...text.matchAll(/axiom-arrival-(\d+)/g)];const row=byId.get(Number(ids.at(-1)?.[1]));
  assert.ok(row,'request must match a real invocation; prewarming cannot infer');row.requests++;
  row.prepareMs??=performance.now()-row.started;
  res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta:{role:'assistant',content:'Synthetic benchmark response.'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}})}\n\ndata: [DONE]\n\n`);
}catch(error){fixtureFailure=String(error);res.writeHead(500);res.end('fixture');}});
await new Promise(r=>http.listen(0,'127.0.0.1',r));
writeFileSync(join(pi,'models.json'),JSON.stringify({providers:{fixture:{api:'openai-completions',baseUrl:`http://127.0.0.1:${http.address().port}/v1`,models:[{id:'fixture',contextWindow:128000,maxTokens:256}]}}}));
writeFileSync(join(pi,'auth.json'),JSON.stringify({fixture:{type:'api_key',key:'fixture'}}));
writeFileSync(join(pi,'settings.json'),JSON.stringify({retry:{enabled:false},compaction:{enabled:false},cacheWarming:'off'}));
const store=new Store(root),models=new ModelService(root),agents=new Agents(store,models,()=>{}),selection={provider:'fixture',id:'fixture',thinking:'off'};
report.poolLimits={...agents.pool.limits};
const space=store.execute({requestId:randomUUID(),op:'workspace.open',params:{path:cwd,authorized:true}});
const create=()=>{const session=store.execute({requestId:randomUUID(),op:'session.create',workspaceId:space.id});store.db.prepare('INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?)').run(session.id,JSON.stringify(selection));return{workspaceId:space.id,sessionId:session.id};};
const wait=async(check)=>{const until=Date.now()+120000;while(!check()){assert.ok(Date.now()<until,'settlement timeout');await new Promise(r=>setTimeout(r,5));}};
agents.onEvent=(scope,_run,event)=>{const row=byScope.get(scope.sessionId);if(row&&event.type==='message'&&event.message?.role==='assistant'&&event.message.text)row.firstOutputMs??=performance.now()-row.started;};
agents.pool.onMetric=value=>report.metrics.push({...value,observedAtMonoMs:performance.now()});
const children=(strict=false)=>{try{return readdirSync(probe).filter(n=>n.endsWith('.json')).flatMap(n=>{try{const c=JSON.parse(readFileSync(join(probe,n),'utf8'));assert.ok(['pid','cpuMs','lastRSS','maxRSSBytes'].every(k=>Number.isFinite(c[k])&&c[k]>=0));return[c];}catch(error){if(strict)(report.resourceErrors??=[]).push(`${n}: ${error}`);return[];}});}catch(error){const message=String(error);report.resourceErrors??=[];if(!report.resourceErrors.includes(message))report.resourceErrors.push(message);return[];}};
let peakRssSumBytes=0,peakWorkerCount=0;
const sampler=setInterval(()=>{const live=children().filter(c=>!c.exited&&Date.now()-c.observedAt<1000);peakWorkerCount=Math.max(peakWorkerCount,live.length);peakRssSumBytes=Math.max(peakRssSumBytes,live.reduce((n,c)=>n+c.lastRSS,0));},250);
const cpu=process.cpuUsage(),begin=performance.now();
async function execute(index,scheduled){
  const row={index,scheduled,started:performance.now(),requests:0,status:'running',prepareMs:null,firstOutputMs:null};
  let scope;
  row.arrivalLagMs=row.started-scheduled;byId.set(index,row);
  if(index>0)report.samples.push(row);
  const prompt=`Synthetic benchmark. Return a short answer. axiom-arrival-${index}`;
  try{
    scope=create();byScope.set(scope.sessionId,row);
    if(scenario==='memory'){await agents.memories.runner.execute({scope,kind:index%3===1?'organize':'query',selection,prompt,read:()=>{throw Error('No candidates');}});row.firstOutputMs=performance.now()-row.started;row.firstOutputEndpoint='result_returned';}
    else{await agents.command({requestId:randomUUID(),op:'prompt',...scope,params:{text:prompt}});await wait(()=>!agents.active(scope));assert.equal(agents.info(scope).run?.status,'completed');}
    assert.ok(row.requests>0);row.status='completed';
  }catch(error){row.status='failed';row.error=String(error);}
  finally{
    row.totalMs=performance.now()-row.started;
    if(scope){byScope.delete(scope.sessionId);try{await agents.releaseIdle(scope);}catch(error){row.status='failed';row.cleanupError=String(error);}}
  }
  return row;
}
try{
  report.seed=await execute(0,performance.now());assert.equal(report.seed.status,'completed');await agents.pool.waitForPrewarm();
  report.measurementMetricOffset=report.metrics.length;
  const epoch=performance.now();const pending=[];
  for(let i=1;i<=count;i++){
    const scheduled=epoch+(i-1)*interval,delay=scheduled-performance.now();if(delay>0)await new Promise(r=>setTimeout(r,delay));
    pending.push(execute(i,scheduled));
  }
  await Promise.allSettled(pending);assert.equal(fixtureFailure,undefined);assert.ok(report.samples.every(s=>s.status==='completed'),'unexpected request failures');report.status='completed';
}catch(error){report.status='failed';report.error=String(error);process.exitCode=1;}
finally{
  clearInterval(sampler);
  const cleanupErrors=[];
  try{await agents.pool.waitForPrewarm();await agents.close();}catch(error){cleanupErrors.push(String(error));try{await agents.close();}catch(closeError){cleanupErrors.push(String(closeError));}}
  const usage=process.cpuUsage(cpu),workers=children(true);
  if(workers.length!==agents.pool.stats().created)(report.resourceErrors??=[]).push('Worker probe coverage does not match created processes');
  report.resources={valid:!report.resourceErrors?.length,windowMs:performance.now()-begin,parentCpuMs:(usage.user+usage.system)/1000,childCpuMs:report.resourceErrors?.length?null:workers.reduce((n,c)=>n+c.cpuMs,0),peakWorkerCount,peakRssSumBytes,workers,finalPool:agents.pool.stats()};
  try{store.close();}catch(error){cleanupErrors.push(String(error));}
  try{http.closeAllConnections();await new Promise(r=>http.close(r));rmSync(root,{recursive:true,force:true});}catch(error){cleanupErrors.push(String(error));}
  if(cleanupErrors.length||report.resourceErrors?.length){report.cleanupErrors=cleanupErrors;report.status='failed';process.exitCode=1;}
  const quantile=(rows,p)=>{const a=rows.filter(v=>v!==null).sort((a,b)=>a-b);return a.length?a[Math.ceil(a.length*p)-1]:null;};
  const successful=report.samples.filter(s=>s.status==='completed');
  report.summary={launched:report.samples.length,successful:successful.length,prepareP50:quantile(successful.map(s=>s.prepareMs),.5),prepareP95:quantile(successful.map(s=>s.prepareMs),.95),arrivalLagP95:quantile(report.samples.map(s=>s.arrivalLagMs),.95)};
  mkdirSync(resolve(output,'..'),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({output,status:report.status,summary:report.summary,error:report.error}));
}
