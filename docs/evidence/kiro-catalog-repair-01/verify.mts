import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { Socket } from 'node:net';
import { createModelRuntime } from '../../../app/src/server/model-runtime.js';
import { readModelCredential } from '../../../app/src/server/model-account-storage.js';
import { kiroNativeFetch } from '../../../app/src/server/providers/kiro-native.js';
import { providerRequestDefaultTransport } from '../../../app/src/server/provider-request-observer.js';
import { withKiroRunIdentity } from '../../../app/src/server/kiro-run-identity.js';
import { InMemoryModelsStore, InMemoryCredentialStore } from '../../../app/node_modules/@earendil-works/pi-ai/dist/index.js';
import { getGlobalDispatcher, setGlobalDispatcher, Agent } from '../../../app/node_modules/undici/index.js';
const dir = new URL('./', import.meta.url), marker='KIRO_CATALOG_OK_703';
const check=(ok:unknown,code:string)=>{if(!ok)throw Error(code);};
const save=(file:string,data:unknown)=>writeFileSync(new URL(file,dir),JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});
const sha=()=>{
 const hash=createHash('sha256');
 const files=['verify.mts','VERIFY-CONTRACT.md','../../../app/src/server/model-runtime.ts','../../../app/src/server/model-account-storage.ts',...['../../../app/src/native-providers/kiro/','../../../app/src/server/providers/'].flatMap(folder=>readdirSync(new URL(folder,dir)).filter(f=>f.endsWith('.ts')&&(folder.includes('native-providers')||f.startsWith('kiro'))).map(f=>folder+f))];
 for(const file of files.sort())hash.update(file).update(readFileSync(new URL(file,dir)));
 return hash.digest('hex');
};
const policy='CALLER_POLICY: Answer the authorized arithmetic check only. No tool use or resource access.';
const question='CALLER_HISTORY: The check is 19 times 37. Output exactly KIRO_CATALOG_OK_ followed by the result.';
const syntheticModel={modelId:'deepseek-3.2',modelName:'DeepSeek',tokenLimits:{maxInputTokens:100000,maxOutputTokens:8192}};
function syntheticStream(damaged:boolean) {
 const response={id:'synthetic-response',model:'deepseek-3.2',status:'completed',output:[{type:'message',id:'msg',role:'assistant',status:'completed',content:[{type:'output_text',text:marker,annotations:[]}]}],usage:{input_tokens:10,output_tokens:8,total_tokens:18}};
 const item=response.output[0];
 const events=[{type:'response.created',response:{id:response.id,model:response.model}},{type:'response.output_item.added',output_index:0,item:{...item,content:[],status:'in_progress'}},{type:'response.output_text.delta',delta:marker,output_index:0,item_id:item.id,content_index:0},...(damaged?[]:[{type:'response.output_text.done',output_index:0,item_id:item.id,content_index:0,text:marker},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}])];
 return new Response(events.map(event=>`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}});
}
async function run(live:boolean,damaged=false) {
 const originalFetch=globalThis.fetch, connect=Socket.prototype.connect;
 const report:any={catalogRequests:0,authRequests:0,profileRequests:0,modelRequests:0,statuses:[],catalogSuccess:false,modelSuccess:false,activeBodies:0,networkAttempts:0};
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),85000);
 const hardStop=setTimeout(()=>{report.passed=false;report.failure='TOTAL_DEADLINE';if(live)save('verify.json',report);process.exit(1);},90000);
 const owned=new Set<()=>Promise<void>>();
 const temp=live?undefined:mkdtempSync(join(tmpdir(),'kiro-catalog-verify-'));
 const modelsPath=live?join(homedir(),'.pi/agent/models.json'):join(temp!,'models.json');
 const authPath=join(homedir(),'.pi/agent/auth.json');
 let before:string|undefined;
 function wrap(response:Response,cap:number) {
  if(!response.body)return response;
  const reader=response.body.getReader();let size=0,ended=false,cancelling:Promise<void>|undefined;report.activeBodies++;
  const end=()=>{if(!ended){ended=true;report.activeBodies--;owned.delete(cancel);}};
  const cancel=()=>cancelling??=(async()=>{try{await reader.cancel();reader.releaseLock();end();}catch{report.cancelFailed=true;throw Error('CLEANUP_FAILED');}})();
  owned.add(cancel);
  return new Response(new ReadableStream({async pull(c){try{const v=await reader.read();if(v.done){if(!cancelling){reader.releaseLock();end();}c.close();return;}size+=v.value.length;if(size>cap){controller.abort();throw Error('BODY_LIMIT');}c.enqueue(v.value);}catch(e){void cancel().catch(()=>{});c.error(e);}},cancel}),{status:response.status,headers:response.headers});
 }
 try {
  if(!live){setGlobalDispatcher(new Agent());Socket.prototype.connect=function(){report.networkAttempts++;throw Error('NO_NETWORK');} as any;writeFileSync(modelsPath,JSON.stringify({providers:{kiro:{headers:{}}}}));}
  else {
   const config=JSON.parse(readFileSync(modelsPath,'utf8'));check((config.providers?.kiro?.axiomProxy?.mode??'direct')==='direct','PROXY_CHANGED');
   const account=readModelCredential('kiro',authPath) as any;check(account?.type==='oauth'&&account.authMethod==='identity-center'&&account.authRegion==='us-east-1'&&!config.providers?.kiro?.baseUrl,'AUTH_MISSING');
   const { configureModelNetwork }=await import('../../../app/src/server/integrations/model-proxy-env.js');
   configureModelNetwork(join(homedir(),'Library/Application Support/Axiom2'),modelsPath,'kiro');
  }
  before=readFileSync(modelsPath,'utf8');
  const baseFetch=globalThis.fetch;
  globalThis.fetch=async(input,init)=>{
   controller.signal.throwIfAborted();const u=new URL(String(input)),h=new Headers(init?.headers),target=h.get('x-amz-target');let kind:string;
   if(u.origin==='https://management.us-east-1.kiro.dev'&&u.pathname==='/'&&u.search===''&&target==='KiroControlPlaneBearerService.ListAvailableModels') {check(++report.catalogRequests<=2,'CATALOG_BUDGET');kind='catalog';}
   else if(u.origin==='https://q.us-east-1.amazonaws.com'&&u.pathname==='/'&&target==='AmazonCodeWhispererService.ListAvailableProfiles'){check(++report.profileRequests<=1,'PROFILE_BUDGET');kind='profile';}
   else if(u.origin==='https://oidc.us-east-1.amazonaws.com'&&u.pathname==='/token'){check(++report.authRequests<=1,'AUTH_BUDGET');kind='auth';}
   else throw Error('AUX_DESTINATION');
   const r=live?await baseFetch(input,{...init,signal:AbortSignal.any([controller.signal,...(init?.signal?[init.signal]:[])])}):new Response(JSON.stringify(kind==='profile'?{profiles:[{arn:'arn:aws:codewhisperer:us-east-1:123456789012:profile/test'}]}:{models:[syntheticModel]}));
   report.statuses.push({kind,status:r.status});return wrap(r,2097152);
  };
  const credentials=live?undefined:new InMemoryCredentialStore();
  if(credentials)await credentials.modify('kiro',async()=>({type:'oauth',access:'SYNTHETIC',refresh:'SYNTHETIC',expires:Date.now()+3600000,authMethod:'identity-center',authRegion:'us-east-1'}));
  const runtime=await createModelRuntime({modelsPath,authPath,providerScope:'kiro',credentials,modelsStore:new InMemoryModelsStore(),allowModelNetwork:false,refreshOnCreate:false,signal:controller.signal});
  check(!runtime.getError(),'CONFIGURATION');
  const refreshed=await runtime.refresh({providers:['kiro'],force:true,allowNetwork:true,signal:controller.signal});
  check(!refreshed.aborted&&refreshed.errors.size===0,'CATALOG_FAILED');
  const native=runtime.getRegisteredNativeProvider('kiro')!;
  const catalog=native.getAllModels!();
  report.catalogCount=catalog.length;report.catalogSuccess=report.catalogCount>0;
  const model=catalog.find(m=>m.id==='deepseek-3.2');check(model&&report.catalogSuccess,'MODEL_NOT_IN_CATALOG');
  check(providerRequestDefaultTransport(runtime,model)===kiroNativeFetch,'NATIVE_SENDER');
  const sessionId=randomUUID();
  const sender:typeof fetch=async(input,init)=>{
   controller.signal.throwIfAborted();const u=new URL(String(input)),h=new Headers(init?.headers);let kind:string;
   if(u.origin==='https://q.us-east-1.amazonaws.com'&&h.get('x-amz-target')==='AmazonCodeWhispererService.ListAvailableProfiles')return kiroNativeFetch(input,init);
   else {check(u.origin==='https://runtime.us-east-1.kiro.dev'&&u.pathname==='/v1/responses','MODEL_DESTINATION');check(++report.modelRequests<=1,'MODEL_BUDGET');const p=JSON.parse(String(init?.body));check(p.model==='deepseek-3.2'&&p.stream===true&&JSON.stringify(p.input)===JSON.stringify([{role:'user',content:`<system_prompt>\n${policy}\n</system_prompt>\n\n${question}`}])&&JSON.stringify(p.tools)==='[]','CALLER_CONTEXT');kind='model';}
   const r=live?await kiroNativeFetch(input,{...init,signal:AbortSignal.any([controller.signal,...(init?.signal?[init.signal]:[])])}):syntheticStream(damaged);
   report.statuses.push({kind,status:r.status});return wrap(r,65536);
  };
  const options=withKiroRunIdentity(model,{sessionId,signal:controller.signal,fetch:sender,maxRetries:0,reasoning:undefined,timeoutMs:60000},{sessionId,continuationId:randomUUID()});
  const stream=await runtime.streamSimple(model,{messages:[{role:'system',content:policy,timestamp:1},{role:'user',content:question,timestamp:2}]},options);
  const result=await stream.result();
  report.terminal=['stop','error','aborted','length','toolUse'].includes(result.stopReason)?result.stopReason:'other';
  report.modelSuccess=result.stopReason==='stop'&&result.content.filter(x=>x.type==='text').map(x=>x.text).join('').trim()===marker&&!result.content.some(x=>x.type==='toolCall');
  if(damaged)check(!report.modelSuccess,'BAD_TERMINAL_ACCEPTED');else check(report.modelSuccess,'MODEL_FAILED');
  report.passed=true;
 } catch(error) { const known=['PROXY_CHANGED','AUTH_MISSING','CONFIGURATION','CATALOG_FAILED','MODEL_NOT_IN_CATALOG','NATIVE_SENDER','MODEL_FAILED','BAD_TERMINAL_ACCEPTED','BODY_LIMIT'];report.failure=error instanceof Error&&known.includes(error.message)?error.message:controller.signal.aborted?'TIMEOUT':'HARNESS_OR_TRANSPORT';report.passed=false; }
 finally {
  controller.abort();globalThis.fetch=originalFetch;Socket.prototype.connect=connect;
  let cleanupTimer:ReturnType<typeof setTimeout>|undefined;
  try {await Promise.race([(async()=>{await Promise.all([...owned].map(cancel=>cancel()));await getGlobalDispatcher().close();report.dispatcherClosed=true;})(),new Promise((_,reject)=>{cleanupTimer=setTimeout(()=>reject(Error('CLEANUP_TIMEOUT')),4000);})]);}
  catch {report.cleanupFailed=true;report.passed=false;void getGlobalDispatcher().destroy().catch(()=>{});}
  finally {clearTimeout(cleanupTimer);clearTimeout(timer);try{report.configUnchanged=before!==undefined&&before===readFileSync(modelsPath,'utf8');}catch{report.configUnchanged=false;}if(temp)rmSync(temp,{recursive:true,force:true});clearTimeout(hardStop);}
 }
 report.passed&&=report.activeBodies===0&&!report.cancelFailed&&report.dispatcherClosed===true&&report.configUnchanged;
 return report;
}
async function main(){
 for(const k of ['AXIOM_EXECUTION_PROFILE','AXIOM_MODEL_ACCOUNT_BINDINGS','AXIOM_MODEL_MANAGED_ACCOUNTS','AXIOM_EXECUTION_INSTANCE','AXIOM_EXECUTION_GENERATION'])delete process.env[k];
 if(process.argv[2]==='--live'){const proof=JSON.parse(readFileSync(new URL('verify-selftest.json',dir),'utf8'));check(proof.passed&&proof.sha===sha(),'SELFTEST_REQUIRED');writeFileSync(new URL('verify.claim',dir),'consumed\n',{flag:'wx'});const result=await run(true);save('verify.json',result);console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;}
 else {const good=await run(false),bad=await run(false,true);const proof={passed:good.passed&&bad.passed,sha:sha(),good,bad};save('verify-selftest.json',proof);console.log(JSON.stringify(proof));if(!proof.passed)process.exitCode=1;}
}
main().catch(error=>{console.log(process.argv[2]==='--live'?'harness-gate-failed':String(error));process.exitCode=1;});
