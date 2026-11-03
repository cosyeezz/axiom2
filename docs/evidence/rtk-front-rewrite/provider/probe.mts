import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdirSync,readFileSync,writeFileSync,copyFileSync,chmodSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const base='/tmp/axiom-rtk-provider-real';
const batch=join(base,'batch-'+Date.now()); mkdirSync(batch,{recursive:true});
// Explicit allowlist: never serialize or inherit the calling session's credentials.
for(const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env,{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:join(batch,'home'),XDG_CONFIG_HOME:join(batch,'xdg-config'),XDG_DATA_HOME:join(batch,'xdg-data'),XDG_CACHE_HOME:join(batch,'xdg-cache'),PI_CODING_AGENT_DIR:join(batch,'pi-global'),NO_COLOR:'1',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_PAGER:'cat',PAGER:'cat',RTK_TELEMETRY_DISABLED:'1',DO_NOT_TRACK:'1',RTK_RECALL:'0',RTK_TEE:'0'});
for(const key of ['HOME','XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_CACHE_HOME','PI_CODING_AGENT_DIR']) mkdirSync(process.env[key]!,{recursive:true});
const {SessionManager}=await import('/Volumes/D_Work/axiom2/app/node_modules/@earendil-works/pi-coding-agent/dist/index.js');
const {ExecutionPool}=await import('/Volumes/D_Work/axiom2/app/src/server/execution-pool.ts');
const {ExecutionProfiles}=await import('/Volumes/D_Work/axiom2/app/src/server/execution-profile.ts');
const {atomicRtkJson,rtkConfigPath,rtkDirectory}=await import('/Volumes/D_Work/axiom2/app/src/server/integrations/rtk-config.ts');
const {rtkStats}=await import('/Volumes/D_Work/axiom2/app/src/server/integrations/rtk-stats.ts');
const metadata=JSON.parse(readFileSync('/tmp/axiom-rtk-official-implementation-final/metadata.json','utf8'));
const hash=(x:string|Buffer)=>createHash('sha256').update(x).digest('hex');
const binaryHash=hash(readFileSync(metadata.binary));
function git(cwd:string,args:string[]){const r=spawnSync('/usr/bin/git',args,{cwd,encoding:'utf8',env:process.env});assert.equal(r.status,0,r.stderr);return r.stdout;}
const results:any[]=[];
async function run(name:string,enabled:boolean,large:boolean,command:string,child=false){
 const dir=join(batch,name+(enabled?'-on':'-off')),root=join(dir,'root'),cwd=join(dir,'fixture'),pi=join(root,'pi'),bins=join(dir,'bin');
 for(const d of [cwd,pi,bins])mkdirSync(d,{recursive:true});
 git(cwd,['init','-q']);
 const count=large?140:1;
 for(let i=0;i<count;i++)writeFileSync(join(cwd,large?`long-untracked-测试-${String(i).padStart(3,'0')}-repeatable-provider-wire-measurement-sample-with-details.txt`:'x.txt'),'fixture\n');
 const counter=join(dir,'business.jsonl');
 writeFileSync(join(bins,'git'),`#!/bin/sh\nprintf '%s\\n' "$*" >> '${counter}'\nexec /usr/bin/git "$@"\n`,{mode:0o700});
 process.env.PATH=bins+':/usr/bin:/bin:/usr/sbin:/sbin';
 const install='v1.0.1-'+randomUUID(),bin=join(rtkDirectory(root),'versions',install,'rtk');mkdirSync(join(rtkDirectory(root),'versions',install),{recursive:true});copyFileSync(metadata.binary,bin);chmodSync(bin,0o700);assert.equal(hash(readFileSync(bin)),binaryHash);
 atomicRtkJson(rtkConfigPath(root),{format:1,revision:randomUUID(),enabled,subagents:true,level:'balanced',installation:{directory:install,version:'1.0.1'}});
 writeFileSync(join(pi,'settings.json'),JSON.stringify({retry:{enabled:false},compaction:{enabled:false}}));
 const requests:any[]=[],rawBytes:number[]=[];
 const server=createServer(async(req,res)=>{try{assert.equal(req.url,'/v1/chat/completions');let raw='';for await(const chunk of req)raw+=chunk;requests.push(JSON.parse(raw));rawBytes.push(Buffer.byteLength(raw));assert.ok(requests.length<=2,'unexpected third request');
 res.writeHead(200,{'Content-Type':'text/event-stream'});const first=requests.length===1;
 const delta=first?{role:'assistant',tool_calls:[{index:0,id:'call_fixed',type:'function',function:{name:'bash',arguments:JSON.stringify({command})}}]}:{role:'assistant',content:'Done.'};
 for(const choice of [{delta,finish_reason:null},{delta:{},finish_reason:first?'tool_calls':'stop'}])res.write(`data: ${JSON.stringify({id:'loopback',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,...choice}]})}\n\n`);res.end('data: [DONE]\n\n');}catch(e){res.statusCode=500;res.end(String(e));}});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const modelsFile=join(pi,'models.json');writeFileSync(modelsFile,JSON.stringify({providers:{fixture:{api:'openai-completions',baseUrl:`http://127.0.0.1:${(server.address() as any).port}/v1`,models:[{id:'fixture',contextWindow:32000,maxTokens:1000}]}}}));writeFileSync(join(pi,'auth.json'),JSON.stringify({fixture:{type:'api_key',key:'loopback-only-dummy'}}));
 const manager=SessionManager.create(cwd,root),seed={role:'user' as const,content:'Bound fixture session.',timestamp:1};manager.appendMessage(seed);const sessionFile=manager.getSessionFile()!,prefix=readFileSync(sessionFile,'utf8');
 const selection={provider:'fixture',id:'fixture',thinking:'off' as const};const prepared=new ExecutionProfiles(root).prepare({entry:'agent',cwd,modelDir:pi,modelsRaw:readFileSync(modelsFile,'utf8'),selection,mode:'managed'});
 const environment={...prepared,workerPath:'/Volumes/D_Work/axiom2/app/src/server/agent-worker.ts',execArgv:['--import','/Volumes/D_Work/axiom2/app/node_modules/tsx/dist/loader.mjs']};
 const pool=new ExecutionPool({targetReadyTotal:0},'managed');let timer:any,stderr='',exit:any,events:any[]=[];
 try{const lease=await pool.acquire({environment,kind:'agent',signal:new AbortController().signal,requestStartedAtMonoMs:performance.now()});const proc=await lease.ensureReady();proc.stderr?.on('data',c=>stderr+=c);const exited=new Promise<void>(r=>proc.once('exit',(code,signal)=>{exit={code,signal};r();}));
 proc.on('message',(event:any)=>{events.push(event);if(event.type==='done')void pool.retire(lease.ref,'probe_finished');});timer=setTimeout(()=>void pool.retire(lease.ref,'probe_timeout',true),45000);
 proc.send({type:'start',lease:lease.ref,input:{executionGate:true,root,cwd,modelsFile:environment.modelsFile,file:sessionFile,runId:randomUUID(),selection,prompt:'Execute the fixture command once.',...(child?{task:{id:'probe-child',inputIds:[]}}:{})}});
 await lease.released;await exited;
 writeFileSync(join(dir,'worker.stderr.log'),stderr);assert.equal(events.find(e=>e.type==='done')?.status,'completed',stderr+JSON.stringify(events));assert.deepEqual(exit,{code:0,signal:null});assert.equal(requests.length,2);
 const tools=requests[1].messages.filter((m:any)=>m.role==='tool');assert.equal(tools.length,1);const text=typeof tools[0].content==='string'?tools[0].content:tools[0].content.filter((p:any)=>p.type==='text').map((p:any)=>p.text).join('\n');
 const calls=requests[1].messages.flatMap((m:any)=>m.tool_calls??[]);assert.equal(calls.length,1);assert.equal(JSON.parse(calls[0].function.arguments).command,command);
 const history=readFileSync(sessionFile,'utf8');assert.ok(history.startsWith(prefix),'existing history mutated');const entries=history.trim().split('\n').map(x=>JSON.parse(x));const historyCalls=entries.flatMap((e:any)=>e.message?.content??[]).filter((p:any)=>p.type==='toolCall');assert.equal(historyCalls.length,1);assert.equal(historyCalls[0].arguments.command,command,'persisted assistant history changed');
 const executions=existsSync(counter)?readFileSync(counter,'utf8').trim().split('\n'):[];const business=executions.filter(x=>x.startsWith('status'));assert.equal(business.length,1,JSON.stringify(executions));
 writeFileSync(join(dir,'provider-tool.txt'),text);const stats=rtkStats(root);writeFileSync(join(dir,'rtk-stats.safe.json'),JSON.stringify(stats,null,2));
 const record={name,enabled,role:child?'subagent':'main',command,fixtureFiles:count,toolTextUtf8Bytes:Buffer.byteLength(text),toolTextSha256:hash(text),nextRequestJsonUtf8Bytes:rawBytes[1],requests:requests.length,businessInvocations:business,allGitInvocations:executions,exit,done:'completed',priorHistoryUnchanged:true,assistantCommandUnchanged:true,statsReasons:stats.recent.map((e:any)=>({stage:e.stage,reason:e.reason})),systemHash:hash(JSON.stringify(requests[0].messages.filter((m:any)=>m.role==='system'))),toolsHash:hash(JSON.stringify(requests[0].tools)),artifact:dir};results.push(record);writeFileSync(join(dir,'result.safe.json'),JSON.stringify(record,null,2));console.log(JSON.stringify(record));
 }finally{clearTimeout(timer);await pool.close();environment.release();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
}
try{
 for(const [name,large,command,child] of [['large-status',true,'git status --porcelain -uall',false],['small-status',false,'git status --porcelain -uall',false],['front-status',true,'git status -uall',false],['child-status',true,'git status --porcelain -uall',true]] as const){for(const enabled of [false,true])await run(name,enabled,large,command,child);const [off,on]=results.slice(-2);assert.equal(off.toolsHash,on.toolsHash);}
 const pairs=[];for(let i=0;i<results.length;i+=2){const off=results[i],on=results[i+1];pairs.push({name:off.name,baselineBytes:off.toolTextUtf8Bytes,enabledBytes:on.toolTextUtf8Bytes,savedBytes:off.toolTextUtf8Bytes-on.toolTextUtf8Bytes,baselineNextRequestJsonBytes:off.nextRequestJsonUtf8Bytes,enabledNextRequestJsonBytes:on.nextRequestJsonUtf8Bytes,reasons:on.statsReasons});}
 assert.ok(pairs.some(p=>p.savedBytes>0));assert.ok(pairs.some(p=>p.savedBytes<=0));
 const summary={batch,binary:metadata.binary,binarySha256:binaryHash,version:'1.0.1',pairs,totalBaselineToolBytes:pairs.reduce((n,p)=>n+p.baselineBytes,0),totalEnabledToolBytes:pairs.reduce((n,p)=>n+p.enabledBytes,0),runs:results};writeFileSync(join(batch,'summary.safe.json'),JSON.stringify(summary,null,2));writeFileSync(join(base,'latest.safe.json'),JSON.stringify({batch,summary:join(batch,'summary.safe.json')},null,2));console.log('PASS '+join(batch,'summary.safe.json'));
}catch(e){writeFileSync(join(batch,'failure.log'),String((e as Error).stack));console.error(e);process.exitCode=1;}
