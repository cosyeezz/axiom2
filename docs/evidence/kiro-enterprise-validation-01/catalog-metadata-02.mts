import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {Socket} from 'node:net';
import {getGlobalDispatcher,setGlobalDispatcher,Agent} from '../../../app/node_modules/undici/index.js';
import {readModelCredential} from '../../../app/dist/server/model-account-storage.js';
import {fetchKiroCatalog} from '../../../app/dist/native-providers/kiro/catalog.js';
const dir=new URL('./',import.meta.url),caseId='catalog-metadata-02',id='claude-opus-5.5';
const save=(name:string,value:unknown)=>writeFileSync(new URL(name,dir),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
const check=(ok:unknown)=>{if(!ok)throw Error('GATE');};
const object=(v:any):Record<string,any>=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
function fingerprint(){const h=createHash('sha256'),files=[caseId+'.mts','CATALOG-METADATA-02-CONTRACT.md','../../../app/package-lock.json'];const walk=(p:string)=>{for(const f of readdirSync(new URL(p,dir),{withFileTypes:true})){if(f.isDirectory())walk(p+f.name+'/');else if(/\.(js|cjs|mjs|json)$/.test(f.name))files.push(p+f.name);}};for(const p of ['../../../app/dist/server/','../../../app/dist/shared/','../../../app/dist/native-providers/','../../../app/node_modules/@earendil-works/pi-ai/dist/','../../../app/node_modules/@earendil-works/pi-coding-agent/dist/','../../../app/node_modules/@earendil-works/pi-agent-core/dist/','../../../app/node_modules/undici/'])walk(p);for(const f of files.sort())h.update(f).update(readFileSync(new URL(f,dir)));return h.digest('hex');}
const loaded=fingerprint();
function project(value:any){
 const models=Array.isArray(value?.models)?value.models:[],matches=models.filter((x:any)=>x?.modelId===id);
 const result:any={exactModelPresent:matches.length===1,matchingModels:matches.length};
 if(matches.length!==1)return result;
 let raw=matches[0].additionalModelRequestFieldsSchema;
 result.schemaKind=raw===undefined?'absent':typeof raw==='string'?'string':raw&&typeof raw==='object'&&!Array.isArray(raw)?'object':'other';
 if(typeof raw==='string'){try{raw=JSON.parse(raw);}catch{return {...result,schemaParseFailed:true};}}
 const schema=object(raw),props=object(schema.properties);
 const required=(v:any)=>Array.isArray(v)?v.slice(0,32).map(x=>['thinking','type','effort','output_config','reasoning'].includes(x)?x:'other'):[];
 const scalar=(v:any,allowed:string[])=>typeof v==='string'&&allowed.includes(v)?v:'other';
 const field=(v:any,allowed:string[])=>{const f=object(v);return {present:v!==undefined,enum:Array.isArray(f.enum)?f.enum.slice(0,32).map(x=>scalar(x,allowed)):[],defaultPresent:Object.hasOwn(f,'default'),...(Object.hasOwn(f,'default')?{default:scalar(f.default,allowed)}:{}),required:required(f.required)};};
 result.required=required(schema.required);
 result.thinking=field(object(object(props.thinking).properties).type,['disabled','adaptive','enabled']);
 result.thinkingRequired=required(object(props.thinking).required);
 result.effort={};for(const path of ['output_config','reasoning'])result.effort[path]={...field(object(object(props[path]).properties).effort,['none','minimal','low','medium','high','xhigh','max']),parentRequired:required(object(props[path]).required)};
 return result;
}
const fixture={models:[{
 modelId:id,modelName:'Fixture',supportedInputTypes:['TEXT','IMAGE'],
 additionalModelRequestFieldsSchema:{type:'object',required:['thinking','output_config'],properties:{
  thinking:{required:['type'],properties:{type:{enum:['disabled','adaptive'],default:'adaptive'}}},
  output_config:{required:['effort'],properties:{effort:{enum:['low','medium','high'],default:'medium'}}},
 }},
}]};
async function run(live:boolean,mode='good'){
 const r:any={passed:false,catalogRequests:0,profileRequests:0,modelRequests:0,authRequests:0,statuses:[],activeBodies:0,networkAttempts:0};
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000),hard=setTimeout(()=>{if(live)save(caseId+'-timeout.json',{...r,failure:'HARD_DEADLINE'});process.exit(2);},25000);
 const pending=new Set<Promise<Response>>(),owned=new Set<()=>Promise<void>>(),connect=Socket.prototype.connect;
 const root=join(homedir(),'.pi/agent'),paths=['models.json','settings.json','model-accounts/index.json'].map(p=>join(root,p));
 const optional=(p:string)=>{try{return readFileSync(p,'utf8');}catch(e){if((e as any).code==='ENOENT')return null;throw e;}};
 let before:(string|null)[]=[];
 try{
  let account:any;
  if(live){before=paths.map(optional);const config=JSON.parse(before[0]!);account=readModelCredential('kiro',join(root,'auth.json'));check(account?.type==='oauth'&&account.authMethod==='identity-center'&&account.authRegion==='us-east-1'&&account.expires>Date.now()+60000&&!config.providers?.kiro?.baseUrl&&(config.providers?.kiro?.axiomProxy?.mode??'direct')==='direct');const {configureModelNetwork}=await import('../../../app/dist/server/integrations/model-proxy-env.js');configureModelNetwork(join(homedir(),'Library/Application Support/Axiom2'),paths[0],'kiro');}
  else{setGlobalDispatcher(new Agent());Socket.prototype.connect=function(){r.networkAttempts++;throw Error('NO_NETWORK');} as any;account={type:'oauth',access:'FIXTURE',refresh:'FIXTURE',expires:Date.now()+3600000,authMethod:'identity-center',authRegion:'us-east-1'};}
  const base=globalThis.fetch;
  async function observe(input:any,init?:RequestInit){
   controller.signal.throwIfAborted();const u=new URL(String(input)),h=new Headers(init?.headers);let kind:string;
   check(init?.method==='POST'&&init.redirect==='error'&&typeof init.body==='string'&&Buffer.byteLength(init.body)<=65536&&u.pathname==='/'&&!u.search);
   if(u.origin==='https://q.us-east-1.amazonaws.com'&&h.get('x-amz-target')==='AmazonCodeWhispererService.ListAvailableProfiles'){check(r.profileRequests<1);r.profileRequests++;kind='profile';}
   else if(u.origin==='https://management.us-east-1.kiro.dev'&&h.get('x-amz-target')==='KiroControlPlaneBearerService.ListAvailableModels'){if(r.catalogRequests>=1){r.stopReason='CATALOG_BUDGET';throw Error('BUDGET');}r.catalogRequests++;kind='catalog';const p=JSON.parse(init.body);check(p.origin==='KIRO_CLI'&&typeof p.profileArn==='string'&&!p.nextToken);}
   else throw Error('DESTINATION');
   const signal=AbortSignal.any([controller.signal,...(init?.signal?[init.signal]:[])]);
   let response:Response;
   if(live)response=await base(input,{...init,signal});
   else if(kind==='profile')response=new Response(JSON.stringify({profiles:[{arn:'arn:aws:codewhisperer:us-east-1:123456789012:profile/test'}]}));
   else if(mode==='late'){controller.abort();await new Promise(f=>setTimeout(f,30));response=new Response('{}');}
   else if(mode==='cancel'){controller.abort();response=new Response('{}');}
   else if(mode==='stalled'||mode==='cancelSlow'){response=new Response(new ReadableStream({async cancel(){r.fixtureBodyCancelled=true;if(mode==='cancelSlow')await new Promise(f=>setTimeout(f,100));r.fixtureCancelCompleted=true;}}));setTimeout(()=>controller.abort(),10);}
   else if(mode==='httpError')response=new Response(new ReadableStream({cancel(){r.fixtureBodyCancelled=true;}}),{status:403});
   else if(mode==='oversize')response=new Response('x'.repeat(2097153));
   else if(mode==='invalid')response=new Response('{');
   else response=new Response(JSON.stringify(mode==='pagination'?{...fixture,nextToken:'fixture-next'}:fixture));
   r.statuses.push({kind,status:response.status});
   if(signal.aborted){await response.body?.cancel();signal.throwIfAborted();}
   if(!response.ok||!response.body){r.stopReason='HTTP_STATUS';await response.body?.cancel();r.errorBodyCancelCompleted=true;throw Error('HTTP');}
   const reader=response.body.getReader();r.activeBodies++;
   let stopped=false,cancelling:Promise<void>|undefined;
   const cancel=()=>cancelling??=reader.cancel().catch(()=>{});
   owned.add(cancel);const onAbort=()=>{void cancel();};signal.addEventListener('abort',onAbort,{once:true});
   try{const chunks:Uint8Array[]=[];let bytes=0;for(;;){signal.throwIfAborted();const item=await reader.read();signal.throwIfAborted();if(item.done)break;bytes+=item.value.length;if(bytes>2097152){r.stopReason='BODY_LIMIT';throw Error('LIMIT');}chunks.push(item.value);}
    const raw=Buffer.concat(chunks);if(kind==='catalog'){try{r.projection=project(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)));}catch{r.stopReason='INVALID_JSON';throw Error('JSON');}}
    return new Response(raw,{status:response.status,headers:response.headers});
   }finally{signal.removeEventListener('abort',onAbort);await cancel();reader.releaseLock();if(!stopped){stopped=true;r.activeBodies--;owned.delete(cancel);}}
  }
  const guarded:typeof fetch=(input,init)=>{const p=observe(input,init);pending.add(p);void p.finally(()=>pending.delete(p)).catch(()=>{});return p;};
  const models=await fetchKiroCatalog(account,controller.signal,guarded);
  r.catalogObservationComplete=true;r.returnedModelPresent=models.some(m=>m.id===id);r.schemaParsed=['object','string'].includes(r.projection?.schemaKind)&&!r.projection?.schemaParseFailed;r.passed=r.returnedModelPresent&&r.projection?.exactModelPresent===true&&!r.projection?.schemaParseFailed;
 }catch{r.failure=controller.signal.aborted?'CANCELLED':'OBSERVATION_FAILED';}
 finally{
  controller.abort();Socket.prototype.connect=connect;let cleanup:any,destroyWork:Promise<void>|undefined;
  const cleanupWork=(async()=>{await Promise.allSettled([...pending]);await Promise.all([...owned].map(f=>f()));await getGlobalDispatcher().close();r.dispatcherClosed=true;})();
  try{await Promise.race([cleanupWork,new Promise((_,reject)=>{cleanup=setTimeout(()=>reject(Error()),!live&&mode==='cancelSlow'?20:4000);})]);}
  catch{r.cleanupFailed=true;r.passed=false;destroyWork=getGlobalDispatcher().destroy().then(()=>{r.dispatcherDestroyed=true;}).catch(()=>{r.destroyFailed=true;});}
  finally{clearTimeout(cleanup);clearTimeout(timer);if(!live&&mode==='cancelSlow')await Promise.allSettled([cleanupWork,...(destroyWork?[destroyWork]:[])]);if(!r.cleanupFailed||!live&&mode==='cancelSlow')clearTimeout(hard);r.pending=pending.size;r.configUnchanged=!live||before.length===paths.length&&paths.every((p,i)=>optional(p)===before[i]);}
 }
 r.artifactUnchanged=fingerprint()===loaded;r.clean=r.pending===0&&r.activeBodies===0&&r.dispatcherClosed===true&&!r.cleanupFailed&&r.configUnchanged&&r.artifactUnchanged&&r.networkAttempts===0;r.passed&&=r.clean;return r;
}
async function main(){
 for(const k of ['AXIOM_EXECUTION_PROFILE','AXIOM_MODEL_ACCOUNT_BINDINGS','AXIOM_MODEL_MANAGED_ACCOUNTS','AXIOM_EXECUTION_INSTANCE','AXIOM_EXECUTION_GENERATION'])delete process.env[k];
 if(process.argv.includes('--live')){const proof=JSON.parse(readFileSync(new URL(caseId+'-selftest.json',dir),'utf8'));check(proof.passed&&proof.sha===loaded&&fingerprint()===loaded);save(caseId+'.claim',{consumed:true});const r=await run(true);save(caseId+'.json',r);console.log(JSON.stringify(r));if(!r.passed)process.exitCode=1;}
 else{
  const hostile=structuredClone(fixture) as any;
  hostile.models[0].additionalModelRequestFieldsSchema={required:['PRIVATE'],properties:{thinking:{properties:{type:{enum:['PRIVATE'],default:'PRIVATE'}}}}};
  check(!JSON.stringify(project(hostile)).includes('PRIVATE'));
  const expected=project(fixture);
  check(expected.schemaKind==='object'&&expected.thinking.default==='adaptive'&&JSON.stringify(expected.thinking.enum)==='["disabled","adaptive"]'&&expected.effort.output_config.default==='medium'&&JSON.stringify(expected.effort.output_config.enum)==='["low","medium","high"]'&&expected.effort.reasoning.present===false&&JSON.stringify(expected.required)==='["thinking","output_config"]'&&expected.thinkingRequired[0]==='type'&&expected.effort.output_config.parentRequired[0]==='effort');
  const reports:any={};
  for(const mode of ['good','pagination','oversize','cancel','late','invalid','stalled','httpError','cancelSlow']){reports[mode]=await run(false,mode);console.log(JSON.stringify({fixture:mode,result:reports[mode]}));}
  const proof={passed:reports.good.passed&&JSON.stringify(reports.good.projection)===JSON.stringify(expected)&&Object.entries(reports).every(([k,v]:any)=>(k==='cancelSlow'?v.cleanupFailed&&!v.clean:v.clean)&&(k==='good'||!v.passed)&&v.profileRequests===1&&v.catalogRequests===1&&JSON.stringify(v.statuses)===JSON.stringify([{kind:'profile',status:200},{kind:'catalog',status:k==='httpError'?403:200}]))&&reports.pagination.stopReason==='CATALOG_BUDGET'&&reports.oversize.stopReason==='BODY_LIMIT'&&reports.invalid.stopReason==='INVALID_JSON'&&['cancel','late','stalled','cancelSlow'].every(k=>reports[k].failure==='CANCELLED')&&reports.httpError.stopReason==='HTTP_STATUS'&&reports.stalled.fixtureCancelCompleted&&reports.cancelSlow.fixtureCancelCompleted&&reports.cancelSlow.dispatcherDestroyed&&reports.cancelSlow.pending===0&&reports.cancelSlow.activeBodies===0&&reports.httpError.fixtureBodyCancelled&&reports.httpError.errorBodyCancelCompleted,sha:fingerprint(),reports};
  save(caseId+'-selftest.json',proof);console.log(JSON.stringify(proof));if(!proof.passed)process.exitCode=1;
 }
}
main().catch(()=>{console.log('METADATA_GATE_FAILED');process.exitCode=1;});
