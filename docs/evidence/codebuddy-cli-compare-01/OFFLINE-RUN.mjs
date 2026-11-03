import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const dir=dirname(fileURLToPath(import.meta.url));
const pkg='/Users/dane/.local/share/codebuddy-cli/2.179.0/lib/node_modules/@tencent-ai/codebuddy-code';
const marker='AXIOM_CODEBUDDY_COMPARE_01';
async function run(output) {
  const work=mkdtempSync(join(tmpdir(),'codebuddy-official-offline-'));
  for(const path of ['home','tmp','cwd'])mkdirSync(join(work,path));
  const fixture=createServer((request,response)=>{let bytes=0;request.on('data',chunk=>{bytes+=chunk.length;if(bytes>1048576)request.destroy();});request.on('end',()=>{if(request.url?.split('?')[0]==='/v2/chat/completions'){const model='deepseek-v4.1-flash',chunk=(delta,finish_reason)=>({id:'chatcmpl-synthetic',object:'chat.completion.chunk',created:1700000000,model,choices:[{index:0,delta,finish_reason}]});response.writeHead(200,{'content-type':'text/event-stream','connection':'close'});for(const value of [chunk({role:'assistant',content:''},null),chunk({content:marker},null),chunk({},'stop'),{id:'chatcmpl-synthetic',object:'chat.completion.chunk',created:1700000000,model,choices:[],usage:{prompt_tokens:20,completion_tokens:8,total_tokens:28}}])response.write('data: '+JSON.stringify(value)+'\n\n');response.end('data: [DONE]\n\n');}else{response.writeHead(200,{'content-type':'application/json','connection':'close'});response.end(JSON.stringify({code:0,data:{models:[],availableModels:[]}}));}});});
  await new Promise(done=>fixture.listen(0,'127.0.0.1',done));
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const token=encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:'synthetic-test',nickname:'synthetic',iss:'https://copilot.tencent.com',exp:Math.floor(Date.now()/1000)+3600})+'.SYNTHETIC';
  const args=['--max-old-space-size=512','--require',join(dir,'OFFLINE-NATIVE-PRELOAD.cjs'),join(pkg,'bin/codebuddy'),'--print','--host','127.0.0.1','--output-format','json','--model','deepseek-v4.1-flash','--settings','{"alwaysThinkingEnabled":false}','--setting-sources','','--tools','','--max-turns','1','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--no-plugin-management','--no-session-persistence',`Reply exactly ${marker}.`];
  const env={PATH:process.env.PATH,HOME:join(work,'home'),TMPDIR:join(work,'tmp'),XDG_CONFIG_HOME:join(work,'home/config'),XDG_CACHE_HOME:join(work,'home/cache'),CODEBUDDY_CONFIG_DIR:join(work,'home/config'),CODEBUDDY_DATA_ROOT:join(work,'home/data'),CODEBUDDY_CREDENTIALS_IN_MEMORY:'1',CODEBUDDY_DISABLE_COMPILE_CACHE:'1',CODEBUDDY_AUTH_TOKEN:token,AXIOM_CB_OFFLINE:'1',AXIOM_CB_FIXTURE_PORT:String(fixture.address().port),AXIOM_CB_OFFLINE_PRIVATE_WRITES:process.argv.includes('--private-writes')?'1':'0',LANG:'en_US.UTF-8',NO_COLOR:'1'};
  let stdout='',stderr='',report='',timedOut=false,outputLimited=false;
  const child=spawn(process.execPath,args,{cwd:join(work,'cwd'),env,stdio:['ignore','pipe','pipe','ignore','pipe']});
  const cap=(key,data)=>{if(key==='stdout')stdout+=data;else if(key==='stderr')stderr+=data;else report+=data;if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)+Buffer.byteLength(report)>65536){outputLimited=true;child.kill('SIGKILL');}};
  child.stdout.on('data',data=>cap('stdout',data));child.stderr.on('data',data=>cap('stderr',data));child.stdio[4].on('data',data=>cap('report',data));
  const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},20000);
  const exit=await new Promise(done=>{child.once('close',(code,signal)=>done({code,signal}));child.once('error',()=>done({code:null,signal:'SPAWN_ERROR'}));});clearTimeout(timer);
  let projection;try{projection=JSON.parse(report.trim().split('\n').at(-1));}catch{}
  const words=['unknown option','OFFLINE_CHILD_BLOCKED','OFFLINE_NETWORK_BLOCKED','OFFLINE_PATH_BLOCKED','ENOENT','EACCES','TypeError','authentication','login','model','Error','error'];
  let messages;try{messages=JSON.parse(stdout);}catch{}
  const assistant=Array.isArray(messages)?messages.filter(item=>item?.role==='assistant'):[];
  const last=assistant.at(-1),answer=typeof last?.content==='string'?last.content:Array.isArray(last?.content)?last.content.map(part=>typeof part?.text==='string'?part.text:'').join(''):'';
  const assistantMarker=answer.trim()===marker;
  const result={privateWrites:env.AXIOM_CB_OFFLINE_PRIVATE_WRITES==='1',assistantMessages:assistant.length,assistantMarker,assistantKeys:last?Object.keys(last):[],passed:exit.code===0&&projection?.networkAttempts===0&&projection.requests?.filter(r=>r.kind==='model').length===1&&assistantMarker,exit,timedOut,outputLimited,projection,stdoutHasMarker:stdout.includes(marker),stdoutBytes:Buffer.byteLength(stdout),stderrBytes:Buffer.byteLength(stderr),diagnosticWords:words.filter(word=>(stdout+'\n'+stderr).includes(word)),offlineStdout:stdout.slice(0,1024).replaceAll(token,'[SYNTHETIC_TOKEN]').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[JWT]'),syntheticTokenInCapturedOutput:(stdout+stderr+report).includes(token),
    preloadSHA256:createHash('sha256').update(readFileSync(join(dir,'OFFLINE-PRELOAD.cjs'))).digest('hex'),nativePreloadSHA256:createHash('sha256').update(readFileSync(join(dir,'OFFLINE-NATIVE-PRELOAD.cjs'))).digest('hex'),headlessSHA256:createHash('sha256').update(readFileSync(join(pkg,'dist/codebuddy-headless.js'))).digest('hex')};
  fixture.closeAllConnections();await new Promise(done=>fixture.close(done));
  rmSync(work,{recursive:true,force:true});
  writeFileSync(join(dir,output),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)run(process.argv[2]??'offline-01.json').catch(()=>{console.log('{"passed":false,"failure":"OFFLINE_SETUP"}');process.exitCode=1;});
