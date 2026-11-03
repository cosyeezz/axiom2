import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Socket} from 'node:net';
import {binding as officialBinding} from './OFFICIAL-RUN.mjs';
import {openRuntime,configSnapshot,unchanged,sha,check,SafeFailure} from './RUNTIME.mjs';
import projection from './PROJECTION.cjs';
const dir=dirname(fileURLToPath(import.meta.url)),{MODEL,MARKER,requestProjection,responseProjection}=projection;
export const binding=()=>({...officialBinding(),axiomSHA256:sha(readFileSync(fileURLToPath(import.meta.url)))});
const save=(name,value)=>{check(/^[a-zA-Z0-9-]+\.json$/.test(name),'OUTPUT_NAME');writeFileSync(join(dir,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});};
const diagnostic=item=>{const d=item?.details??{};return {type:item?.type==='codebuddy-failure'?'codebuddy-failure':'other',stage:['request','transport','response','stream'].includes(d.stage)?d.stage:'other',partial:d.partial===true,protocolCode:['request','target','thinking','tool','response','stream','terminal','usage'].includes(d.protocolCode)?d.protocolCode:undefined,category:['quota','permission','auth','context','upstream'].includes(d.category)?d.category:undefined,status:Number.isSafeInteger(d.status)?d.status:undefined,businessCode:Number.isSafeInteger(d.businessCode)?d.businessCode:undefined};};
export async function run({live=false,broken=false,cut=false,output='axiom-fixture-01.json'}={}){
  const state={live,broken,cut,refreshRequests:0,logicalCalls:0,modelSends:0,observerStarts:0,observerEnds:0,activeBodies:0,networkAttempts:0,passed:false,binding:binding()},snapshot=live?configSnapshot():undefined;
  let context,agent,temporary,timer;const controller=new AbortController(),originalConnect=Socket.prototype.connect;
  try{
    if(live){const ready=JSON.parse(readFileSync(join(dir,'axiom-readiness.json'),'utf8'));check(ready.passed&&JSON.stringify(ready.binding)===JSON.stringify(state.binding),'AXIOM_READINESS');check(!broken&&!cut,'LIVE_BROKEN');save('axiom-live-claim.json',{model:MODEL,modelRequests:1,thinking:'off',binding:state.binding});}
    else{temporary=mkdtempSync(join(tmpdir(),'axiom-compare-fixture-'));Socket.prototype.connect=function(){state.networkAttempts++;throw new SafeFailure('FIXTURE_NETWORK');};}
    context=await openRuntime({live,temporary,state});const {m,runtime,model,sessionId,runId}=context;
    timer=setTimeout(()=>{state.timedOut=true;controller.abort();agent?.abort();},60000);
    const sender=async(url,init)=>{
      check(String(url)==='https://copilot.tencent.com/v2/chat/completions'&&init?.method==='POST','MODEL_DESTINATION');check(state.modelSends===0,'MODEL_BUDGET');controller.signal.throwIfAborted();
      check(typeof init.body==='string'&&Buffer.byteLength(init.body)<=1048576,'REQUEST_BYTES');const headers=Object.fromEntries(new Headers(init.headers)),request=requestProjection(Buffer.from(init.body),headers),credential=await context.readCredential();
      check(request.modelMatches&&request.off&&request.stream&&request.promptPresent&&request.toolCount===0&&request.maxTokens===256,'MODEL_PARAMETERS');check(headers.authorization===`Bearer ${credential.access}`&&headers['user-agent']==='CLI/2.179.0 CodeBuddy/2.179.0','AUTH_UA');
      check(headers['x-conversation-id']===sessionId&&headers['x-conversation-request-id']===runId&&request.invocationEqualsMessage,'IDENTITY');state.request=request;state.modelSends++;
      const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(45000),...(init.signal?[init.signal]:[])]);
      const chunk={model:MODEL,choices:[{index:0,delta:{role:'assistant',content:MARKER},finish_reason:broken||cut?null:'stop'}]};
      const fixtureBody=cut?new ReadableStream({start(out){out.enqueue(Buffer.from(`data: ${JSON.stringify(chunk)}\n\n`));setTimeout(()=>out.error(Error('SYNTHETIC_CUT')),10);}}):`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`;
      const response=live?await m.codeBuddyNativeFetch(url,{...init,signal}):new Response(fixtureBody,{headers:{'content-type':'text/event-stream'}});
      state.httpStatus=response.status;check(response.body,'RESPONSE_BODY');const reader=response.body.getReader();let parts=[],size=0,finished=false;state.activeBodies++;
      const finish=reason=>{if(finished)return;finished=true;state.activeBodies--;state.responseExit=reason;state.responseBytes=size;try{state.response=responseProjection(Buffer.concat(parts),Object.fromEntries(response.headers));}catch{state.projectionFailed=true;}parts=[];};
      return new Response(new ReadableStream({async pull(out){try{signal.throwIfAborted();const part=await reader.read();if(part.done){reader.releaseLock();finish('eof');out.close();return;}size+=part.value.length;check(size<=65536,'RESPONSE_BYTES');parts.push(Buffer.from(part.value));out.enqueue(part.value);}catch(error){await reader.cancel().catch(()=>{});finish('error');out.error(error);}},async cancel(){await reader.cancel().catch(()=>{});finish('consumer-cancel');}}),{status:response.status,headers:response.headers});
    };
    const stream=m.observeProviderRequests(runtime.streamSimple.bind(runtime),event=>{if(event.phase==='start')state.observerStarts++;if(event.phase==='end')state.observerEnds++;},(model,options)=>m.providerRequestHttpTransport(runtime,model,options),()=>sender);
    agent=new m.Agent({sessionId,initialState:{model,thinkingLevel:'off',systemPrompt:'Follow the user request. Do not call tools or access other resources.',messages:[],tools:[]},beforeToolCall:()=>{throw new SafeFailure('TOOL_FORBIDDEN');},streamFn:(model,ctx,options)=>{check(state.logicalCalls++===0,'LOGICAL_BUDGET');return stream(model,ctx,m.withCodeBuddyRunIdentity(model,{...options,sessionId,signal:AbortSignal.any([controller.signal,...(options?.signal?[options.signal]:[])]),maxTokens:256,maxRetries:0,timeoutMs:45000},{sessionId,continuationId:runId}));}});
    await agent.prompt(`Reply exactly ${MARKER}.`);const last=agent.state.messages.at(-1);
    state.assistant=last?.role==='assistant';state.stopReason=['stop','error','aborted','length','toolUse'].includes(last?.stopReason)?last.stopReason:'other';state.assistantExact=last?.content?.filter(part=>part.type==='text').map(part=>part.text).join('').trim()===MARKER;
    state.diagnostics=(last?.diagnostics??[]).map(diagnostic);state.toolCalls=last?.content?.filter(part=>part.type==='toolCall').length??0;
    state.passed=state.modelSends===1&&state.observerStarts===1&&state.observerEnds===1&&state.activeBodies===0&&!state.toolCalls&&(cut?state.stopReason==='error'&&state.responseExit==='error'&&state.responseBytes>0&&!state.response.done:broken?state.stopReason==='error'&&state.diagnostics.some(item=>item.protocolCode==='terminal'):state.stopReason==='stop'&&state.assistantExact&&state.response?.strictTerminal&&state.responseExit==='eof');
  }catch(error){state.failure=error instanceof SafeFailure?error.code:'AXIOM_SETUP_OR_STREAM';}
  finally{clearTimeout(timer);controller.abort();agent?.abort();try{await agent?.waitForIdle();state.agentSettled=!agent?.state.isStreaming;await context?.close();}catch{state.passed=false;state.cleanupFailure=true;}Socket.prototype.connect=originalConnect;if(temporary)rmSync(temporary,{recursive:true,force:true});state.configUnchanged=!live||unchanged(snapshot);state.passed=!!state.passed&&state.configUnchanged&&state.activeBodies===0;}
  save(output,state);return state;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const mode=process.argv[2];if(!['--live','--fixture','--broken','--cut'].includes(mode)){console.log('{"passed":false,"failure":"MODE_REQUIRED"}');process.exitCode=1;}else run({live:mode==='--live',broken:mode==='--broken',cut:mode==='--cut',output:process.argv[3]??(mode==='--live'?'axiom-live.json':'axiom-fixture-01.json')}).then(result=>{console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;}).catch(()=>{console.log('{"passed":false,"failure":"AXIOM_RUNNER_FAILURE"}');process.exitCode=1;});}
