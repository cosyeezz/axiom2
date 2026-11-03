import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync } from 'node:fs';
import { join,dirname,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath,pathToFileURL } from 'node:url';
import projection from './PROJECTION.cjs';
import {sha,check,SafeFailure,openRuntime,configSnapshot,unchanged,frozenRuntime} from './RUNTIME.mjs';
const {MODEL,MARKER}=projection,dir=dirname(fileURLToPath(import.meta.url));
const pkg='/Users/dane/.local/share/codebuddy-cli/2.179.0/lib/node_modules/@tencent-ai/codebuddy-code';
const files=['OFFICIAL-RUN.mjs','LIVE-PRELOAD.cjs','ISOLATION.cjs','PROJECTION.cjs','RUNTIME.mjs'];
export function binding(){const headlessSHA256=sha(readFileSync(join(pkg,'dist/codebuddy-headless.js')));check(headlessSHA256==='dfba8dc057a592d1428ed2db9554aa3d5640674c9e98d794f1cce1783be5afa8','OFFICIAL_CHANGED');return {files:files.map(path=>({path,sha256:sha(readFileSync(join(dir,path)))})),headlessSHA256,launcherSHA256:sha(readFileSync(join(pkg,'bin/codebuddy'))),node:process.version};}
const save=(name,value)=>{check(/^[a-zA-Z0-9-]+\.json$/.test(name),'OUTPUT_NAME');writeFileSync(join(dir,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});};
const syntheticToken=()=>{const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');return encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:'synthetic-test',nickname:'synthetic',iss:'https://copilot.tencent.com',exp:Math.floor(Date.now()/1000)+3600})+'.SYNTHETIC';};
export async function run({live=false,output='official-fixture-01.json',driver,scenario}){
  const state={live,refreshRequests:0,passed:false},snapshot=live?configSnapshot():undefined,artifact=binding();let runtime,work,server,child,timer;
  try{
    check(!live||!driver,'LIVE_DRIVER_FORBIDDEN');
    if(live){
      const ready=JSON.parse(readFileSync(join(dir,'official-readiness.json'),'utf8'));check(ready.passed&&JSON.stringify(ready.binding)===JSON.stringify(artifact),'READINESS');frozenRuntime();
      check(process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0'&&!process.env.NODE_OPTIONS,'NODE_ENVIRONMENT');
      const systemProxy=execFileSync('/usr/sbin/scutil',['--proxy'],{encoding:'utf8',timeout:5000,maxBuffer:65536});check(!/\b(?:HTTPEnable|HTTPSEnable|SOCKSEnable|ProxyAutoConfigEnable|ProxyAutoDiscoveryEnable)\s*:\s*1\b/.test(systemProxy),'SYSTEM_PROXY_ENABLED');state.systemProxyEnabled=false;
      const preflight=await openRuntime({live:true,state,metadataOnly:true});await preflight.close();check(state.refreshRequests===0&&unchanged(snapshot),'PREFLIGHT_MUTATION');
      const claim={parentPid:process.pid,model:MODEL,officialModelRequests:1,catalogRequests:1,geoblockRequests:1,refreshRequests:1,preloadSHA256:artifact.files.find(file=>file.path==='LIVE-PRELOAD.cjs').sha256,binding:artifact};save('official-live-claim.json',claim);
      runtime=await openRuntime({live:true,state});
    }
    work=mkdtempSync(join(tmpdir(),'codebuddy-compare-'));for(const path of ['home','tmp','cwd'])mkdirSync(join(work,path));
    let fixtureModels=0,fixtureOther=0;
    server=createServer((request,response)=>{let bytes=0;request.on('data',chunk=>{bytes+=chunk.length;if(bytes>1048576)request.destroy();});request.on('end',()=>{
      if(request.url==='/v2/chat/completions'&&!live){fixtureModels++;const chunk=(delta,finish_reason)=>({model:MODEL,choices:[{index:0,delta,finish_reason}]});response.writeHead(200,{'content-type':'text/event-stream','connection':'close'});for(const value of [chunk({role:'assistant',content:''},null),chunk({content:MARKER.slice(0,10)},null),chunk({content:MARKER.slice(10)},null),chunk({},'stop'),{model:MODEL,choices:[],usage:{prompt_tokens:20,completion_tokens:8,total_tokens:28}}])response.write('data: '+JSON.stringify(value)+'\n\n');response.end('data: [DONE]\n\n');
      }else if(['/v1/traces','/v2/report'].includes(request.url)){fixtureOther++;response.writeHead(204,{'connection':'close'});response.end();}
      else if(!live&&['/v3/config','/v2/geoblock'].includes(request.url)){fixtureOther++;response.writeHead(200,{'content-type':'application/json','connection':'close'});response.end(JSON.stringify({code:0,data:{models:[],availableModels:[]}}));}
      else{state.localUnexpected=true;response.writeHead(403,{'connection':'close'});response.end();}
    });});
    await new Promise(done=>server.listen(0,'127.0.0.1',done));
    const args=['--max-old-space-size=512','--require',join(dir,'LIVE-PRELOAD.cjs'),...(driver?[driver,scenario]:[join(pkg,'bin/codebuddy'),'--print','--host','127.0.0.1','--output-format','json','--model',MODEL,'--settings','{"alwaysThinkingEnabled":false}','--setting-sources','','--tools','','--max-turns','1','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--no-plugin-management','--no-session-persistence',`Reply exactly ${MARKER}.`])];
    const env={PATH:process.env.PATH,HOME:join(work,'home'),TMPDIR:join(work,'tmp'),XDG_CONFIG_HOME:join(work,'home/config'),XDG_CACHE_HOME:join(work,'home/cache'),CODEBUDDY_CONFIG_DIR:join(work,'home/config'),CODEBUDDY_DATA_ROOT:join(work,'home/data'),CODEBUDDY_CREDENTIALS_IN_MEMORY:'1',CODEBUDDY_DISABLE_COMPILE_CACHE:'1',AXIOM_CB_MODE:live?'live':'fixture',AXIOM_CB_FIXTURE_PORT:String(server.address().port),AXIOM_CB_CLAIM:join(dir,'official-live-claim.json'),LANG:'en_US.UTF-8',NO_COLOR:'1'};
    let stdout='',stderr='',report='',lastReport='',total=0;
    child=spawn(process.execPath,args,{cwd:join(work,'cwd'),env,stdio:['ignore','pipe','pipe','pipe','pipe']});
    const token=live?runtime.access:syntheticToken();child.stdio[3].on('error',()=>{});child.stdio[3].end(JSON.stringify({token}));
    const cap=(key,buffer)=>{total+=buffer.length;if(total>524288){state.outputLimited=true;child.kill('SIGKILL');return;}if(key==='stdout')stdout+=buffer;else if(key==='stderr')stderr+=buffer;else{report+=buffer;const lines=report.split('\n');report=lines.pop();if(lines.length)lastReport=lines.at(-1);}if(Buffer.byteLength(stdout)>65536||Buffer.byteLength(stderr)>16384||Buffer.byteLength(report)>65536||Buffer.byteLength(lastReport)>65536){state.outputLimited=true;child.kill('SIGKILL');}};
    child.stdout.on('data',data=>cap('stdout',data));child.stderr.on('data',data=>cap('stderr',data));child.stdio[4].on('data',data=>cap('report',data));
    timer=setTimeout(()=>{state.timedOut=true;child.kill('SIGKILL');},live?90000:25000);
    state.exit=await new Promise(done=>{child.once('close',(code,signal)=>done({code,signal}));child.once('error',()=>done({code:null,signal:'SPAWN_ERROR'}));});clearTimeout(timer);
    let observed;try{observed=JSON.parse(lastReport);}catch{}state.observation=observed;
    let messages;try{messages=JSON.parse(stdout);}catch{}const assistants=Array.isArray(messages)?messages.filter(message=>message?.role==='assistant'):[],last=assistants.at(-1);
    const text=typeof last?.content==='string'?last.content:Array.isArray(last?.content)?last.content.map(part=>typeof part?.text==='string'?part.text:'').join(''):'';
    state.assistantMessages=assistants.length;state.assistantExact=text.trim()===MARKER;state.stdoutBytes=Buffer.byteLength(stdout);state.stderrBytes=Buffer.byteLength(stderr);state.totalOutputBytes=total;state.tokenInOutput=(stdout+stderr+lastReport).includes(token);
    state.fixtureModels=fixtureModels;state.fixtureOther=fixtureOther;
    const model=observed?.requests?.find(request=>request.kind==='model');
    state.passed=state.exit.code===0&&!state.timedOut&&!state.outputLimited&&!state.localUnexpected&&!observed?.failure&&observed?.modelSends===1&&observed?.activeRequests===0&&observed?.networkDenied===0&&model?.status===200&&model.responseEnded&&model.response?.strictTerminal&&state.assistantExact;
    if(driver)state.passed=state.exit.code===0&&!state.timedOut&&!state.outputLimited;
  }catch(error){state.failure=error instanceof SafeFailure?error.code:'OFFICIAL_SETUP';}
  finally{clearTimeout(timer);if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');if(server){server.closeAllConnections();await new Promise(done=>server.close(done));}if(work)rmSync(work,{recursive:true,force:true});try{await runtime?.close();}catch{state.passed=false;state.cleanupFailure=true;}state.configUnchanged=!live||unchanged(snapshot);state.passed=!!state.passed&&state.configUnchanged&&!state.tokenInOutput;state.cleaned=true;}
  state.binding=artifact;save(output,state);return state;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const live=process.argv[2]==='--live';if(!live&&process.argv[2]!=='--fixture'){console.log('{"passed":false,"failure":"MODE_REQUIRED"}');process.exitCode=1;}else run({live,output:process.argv[3]??(live?'official-live.json':'official-fixture-01.json')}).then(result=>{console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;}).catch(()=>{console.log('{"passed":false,"failure":"RUNNER_FAILURE"}');process.exitCode=1;});}
