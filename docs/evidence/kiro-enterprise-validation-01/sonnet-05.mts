import {readFileSync,writeFileSync,readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {homedir,tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import ts from '../../../app/node_modules/typescript/lib/typescript.js';
import {Socket} from 'node:net';
import {createModelRuntime} from '../../../app/dist/server/model-runtime.js';
import {readModelCredential} from '../../../app/dist/server/model-account-storage.js';
import {kiroNativeFetch} from '../../../app/dist/server/providers/kiro-native.js';
import {kiroCatalogScope} from '../../../app/dist/server/providers/kiro-catalog.js';
import {providerRequestDefaultTransport} from '../../../app/dist/server/provider-request-observer.js';
import {InMemoryCredentialStore,InMemoryModelsStore,Type} from '../../../app/node_modules/@earendil-works/pi-ai/dist/index.js';
import {getGlobalDispatcher,setGlobalDispatcher,Agent} from '../../../app/node_modules/undici/index.js';
import {fixtureCrc} from '../../../app/tests/fixtures/kiro-eventstream.js';
const evidenceDir=new URL('file:///Volumes/D_Work/axiom2/docs/evidence/kiro-enterprise-validation-01/');
const dir=new URL('./',import.meta.url),id='claude-sonnet-5.5',caseId='sonnet-05';
function sseResponse(kind:'tool'|'text',value:string,broken=false){
 const item=kind==='tool'?{id:'fixture-item',type:'function_call',call_id:'fixture-call',name:'verify_code',arguments:value}:{id:'fixture-item',type:'message',role:'assistant',content:[{type:'output_text',text:value}]};
 const events=kind==='tool'?[
  {type:'response.output_item.added',output_index:0,item:{...item,arguments:''}},
  {type:'response.function_call_arguments.delta',output_index:0,item_id:item.id,delta:value},
  {type:'response.function_call_arguments.done',output_index:0,item_id:item.id,arguments:value}
 ]:[
  {type:'response.output_item.added',output_index:0,item:{...item,content:[]}},
  {type:'response.output_text.delta',output_index:0,item_id:item.id,content_index:0,delta:value},
  {type:'response.output_text.done',output_index:0,item_id:item.id,content_index:0,text:value}
 ];
 events.push({type:'response.output_item.done',output_index:0,item} as any);
 if(!broken)events.push({type:'response.completed',response:{id:'fixture-response',model:id,status:kind==='tool'?'requires_action':'completed',output:[item]}} as any);
 return new Response(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});
}
const check=(ok:unknown,code:string)=>{if(!ok)throw Error(code);};
const verifiedEffort=(r:any)=>JSON.stringify(r.providerEfforts)==='["high","high","high"]'&&JSON.stringify(r.offUnavailableDiagnosed)==='[true,true,true]';
const save=(name:string,value:unknown)=>writeFileSync(new URL(name,evidenceDir),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
function fingerprint(){const h=createHash('sha256');const files=[caseId+'.mts','code-runner.cjs','SONNET-05-CONTRACT.md','../../../app/tests/fixtures/kiro-eventstream.ts','../../../app/package-lock.json','../../../app/node_modules/typescript/lib/typescript.js'];const walk=(folder:string)=>{for(const f of readdirSync(new URL(folder,dir),{withFileTypes:true})){if(f.isDirectory())walk(folder+f.name+'/');else if(/\.(js|cjs|mjs|json)$/.test(f.name))files.push(folder+f.name);}};for(const folder of ['../../../app/dist/server/','../../../app/dist/shared/','../../../app/dist/native-providers/','../../../app/node_modules/@earendil-works/pi-ai/dist/','../../../app/node_modules/@earendil-works/pi-coding-agent/dist/','../../../app/node_modules/@earendil-works/pi-agent-core/dist/','../../../app/node_modules/undici/'])walk(folder);for(const f of files.sort())h.update(f).update(readFileSync(new URL(f,dir)));return h.digest('hex');}
const loadedFingerprint=fingerprint();
const policy='You are an isolated Axiom capability-test assistant. Follow the caller task only. Do not access files, network or external resources. Only the provided verify_code tool is permitted, and only when requested. Keep output concise.';
const coding='Implement a plain JavaScript function mergeIntervals(intervals). Input is an array of finite-number [start,end] pairs with start<=end. Return sorted merged closed intervals, merging overlapping or touching intervals; do not mutate input. Handle empty, duplicate, nested, unsorted and negative intervals. Call verify_code exactly once with source containing only the function declaration, no imports, exports, markdown or test code. After the tool returns, output exactly its receipt field and nothing else.';
const vision='Identify the three colored shapes in this image from left to right. Reply only with a JSON array of objects having exactly color and shape keys, English lowercase basic color names and shape names. No markdown.';
const tool={name:'verify_code',description:'Run ten bounded mergeIntervals tests. A successful result contains an unpredictable receipt that must be returned exactly.',parameters:Type.Object({source:Type.String({maxLength:16384})},{additionalProperties:false})};
const expected=[{color:'red',shape:'square'},{color:'green',shape:'triangle'},{color:'blue',shape:'circle'}];
const sample='function mergeIntervals(intervals) { const a=intervals.map(x=>x.slice()).sort((a,b)=>a[0]-b[0]); const r=[]; for(const p of a){const q=r[r.length-1]; if(q && p[0]<=q[1])q[1]=Math.max(q[1],p[1]); else r.push(p);} return r; }';
const cases=[ [[],[]], [[[1,3],[2,6],[8,10],[15,18]],[[1,6],[8,10],[15,18]]], [[[1,4],[4,5]],[[1,5]]], [[[1,10],[2,3]],[[1,10]]], [[[-5,-2],[-3,1]], [[-5,1]]], [[[8,9],[1,2],[2,4]],[[1,4],[8,9]]], [[[1,2],[1,2]],[[1,2]]], [[[0,0]],[[0,0]]], [[[1,2],[3,4]],[[1,2],[3,4]]], [[[0.1,0.2],[0.2,0.7]],[[0.1,0.7]]] ];
function testCode(source:unknown){check(typeof source==='string'&&source.length<=16384&&!/(?:\b(?:require|import|export|process|globalThis|global|eval|Function|constructor|prototype|this|fetch|WebAssembly|Promise)\b|__proto__)/.test(source),'CODE_POLICY');const ast=ts.createSourceFile('candidate.js',source as string,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);const fn=ast.statements[0];check((ast as any).parseDiagnostics.length===0&&ast.statements.length===1&&ts.isFunctionDeclaration(fn)&&fn.name?.text==='mergeIntervals'&&!fn.asteriskToken&&!fn.modifiers?.length,'CODE_POLICY');const runner=fileURLToPath(new URL('code-runner.cjs',dir));const child=spawnSync(process.execPath,['--experimental-permission','--allow-fs-read='+runner,'--max-old-space-size=64',runner],{input:JSON.stringify({source,cases}),encoding:'utf8',timeout:1500,killSignal:'SIGKILL',maxBuffer:65536,env:{},cwd:tmpdir()});if(child.status!==0||child.signal||child.error)return false;try{return JSON.parse(child.stdout).passed===true;}catch{return false;}}
function image(){const w=360,h=140,raw=Buffer.alloc((w*3+1)*h,255);for(let y=0;y<h;y++){raw[y*(w*3+1)]=0;for(let x=0;x<w;x++){let c:number[]|undefined;if(x>=20&&x<100&&y>=30&&y<110)c=[255,0,0];if(y>=25&&y<=110&&Math.abs(x-180)<=(y-25)*0.5)c=[0,160,0];if((x-300)**2+(y-70)**2<=40**2)c=[0,0,255];if(c)for(let k=0;k<3;k++)raw[y*(w*3+1)+1+x*3+k]=c[k];}}const chunk=(name:string,body:Buffer)=>{const type=Buffer.from(name),head=Buffer.alloc(4),crc=Buffer.alloc(4);head.writeUInt32BE(body.length);crc.writeUInt32BE(fixtureCrc(Buffer.concat([type,body])));return Buffer.concat([head,type,body,crc]);};const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=2;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
const png=image(),imageData=png.toString('base64');
const text=(r:any)=>r.content.filter((x:any)=>x.type==='text').map((x:any)=>x.text).join('').trim();
const readOptional=(p:string)=>{try{return readFileSync(p,'utf8');}catch(e){if((e as any).code==='ENOENT')return null;throw e;}};
async function run(live:boolean,mode='good'){
 const report:any={passed:false,modelRequests:0,profileRequests:0,authRequests:0,catalogRequests:0,activeBodies:0,statuses:[],terminals:[],sseEvents:{},networkAttempts:0};
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),180000),hard=setTimeout(()=>{if(live)save(caseId+'-timeout.json',{...report,failure:'HARD_DEADLINE'});process.exit(2);},185000);
 const original=globalThis.fetch,connect=Socket.prototype.connect,owned=new Set<()=>Promise<void>>(),pending=new Set<Promise<Response>>();
 const temp=live?undefined:mkdtempSync(join(tmpdir(),'sonnet-fixture-'));
 const root=live?join(homedir(),'.pi/agent'):temp!,modelsPath=join(root,'models.json'),authPath=join(root,'auth.json');
 const receipt='SONNET_CODE_OK_'+randomUUID().replaceAll('-','');let firstCall:any;let firstAssistantText='';let conversationId:string|undefined;let phase=0;
 let before:Array<string|null>=[],paths=[modelsPath,join(root,'settings.json'),join(root,'model-accounts/index.json')];
 function wrap(r:Response,cap:number,kind:string){
  if(!r.body)return r;
  const reader=r.body.getReader();let size=0,ended=false,cancelling:Promise<void>|undefined;
  // Observe the actual reader; no tee, clone, second request or raw error persistence.
  const errorChunks:Buffer[]=[];let captured=0,projected=false,overflow=false;
  const project=(complete:boolean)=>{
   if(projected||kind!=='model'||r.ok)return;projected=true;
   const safe:any={bodyState:overflow?'too-large':complete?'invalid':'incomplete',knownCodes:[],knownFields:[],requiresModelOptIn:false};
   if(complete&&!overflow){try{
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(errorChunks)));
    if(value&&typeof value==='object'&&!Array.isArray(value)){
     safe.bodyState='json';const objects=[value,...(value.error&&typeof value.error==='object'&&!Array.isArray(value.error)?[value.error]:[])];
     const allowed=['AccessDeniedException','MissingAuthenticationTokenException','UnknownOperationException','ValidationException','UnauthorizedException','UnrecognizedClientException','ResourceNotFoundException','ThrottlingException'];
     const candidates=[r.headers.get('x-amzn-errortype'),...objects.flatMap(o=>[o.__type,o.code,o.type])];
     safe.knownCodes=[...new Set(candidates.filter((c):c is string=>typeof c==='string'&&c.length<=256).map(c=>c.slice(c.lastIndexOf('#')+1)).filter(c=>allowed.includes(c)))];
     const fields=['reasoning.type','reasoning.effort','reasoning','input','tools','model','instructions','metadata','profileArn','stream','origin'];
     safe.knownFields=[...new Set(objects.flatMap(o=>[o.param,o.field,o.parameter]).filter(v=>typeof v==='string'&&fields.includes(v)))];
     safe.requiresModelOptIn=objects.some(o=>o.reason==='kiro:model_requires_user_opt_in');
    }
   }catch{}}
   errorChunks.length=0;report.modelError=safe;
  };
  report.activeBodies++;const end=()=>{if(!ended){ended=true;report.activeBodies--;owned.delete(cancel);}};
  const cancel=()=>cancelling??=(async()=>{await reader.cancel();project(false);reader.releaseLock();end();})();owned.add(cancel);
  return new Response(new ReadableStream({async pull(c){try{
   const v=await reader.read();if(v.done){project(true);if(!cancelling){reader.releaseLock();end();}c.close();return;}
   size+=v.value.length;if(kind==='model'&&!r.ok){captured+=v.value.length;if(captured<=16384&&!overflow)errorChunks.push(Buffer.from(v.value));else{overflow=true;errorChunks.length=0;}}
   if(size>cap){controller.abort();throw Error('BODY_LIMIT');}c.enqueue(v.value);
  }catch(e){void cancel().catch(()=>{});c.error(e);}},cancel}),{status:r.status,headers:r.headers});
 }
 try{
  let credentials:InMemoryCredentialStore|undefined,modelsStore:InMemoryModelsStore|undefined;
  if(!live){setGlobalDispatcher(new Agent());Socket.prototype.connect=function(){report.networkAttempts++;throw Error('NO_NETWORK');} as any;credentials=new InMemoryCredentialStore();const a={type:'oauth' as const,access:'FIXTURE',refresh:'FIXTURE',expires:Date.now()+3600000,authMethod:'identity-center',authRegion:'us-east-1'};await credentials.modify('kiro',async()=>a);modelsStore=new InMemoryModelsStore();await modelsStore.write('kiro',{cacheVersion:2,cacheScope:kiroCatalogScope(a),checkedAt:Date.now(),models:[]} as any);writeFileSync(modelsPath,JSON.stringify({providers:{kiro:{api:'kiro-chat',models:[{id,name:id,baseUrl:'https://q.us-east-1.amazonaws.com',input:['text','image'],contextWindow:200000,maxTokens:8192}]}}}));}
  else {const a=readModelCredential('kiro',authPath) as any,c=JSON.parse(readFileSync(modelsPath,'utf8'));check(a?.type==='oauth'&&a.authMethod==='identity-center'&&a.authRegion==='us-east-1'&&!c.providers?.kiro?.baseUrl&&(c.providers?.kiro?.axiomProxy?.mode??'direct')==='direct','ACCOUNT');const {configureModelNetwork}=await import('../../../app/dist/server/integrations/model-proxy-env.js');configureModelNetwork(join(homedir(),'Library/Application Support/Axiom2'),modelsPath,'kiro');}
  before=paths.map(readOptional);const base=globalThis.fetch;
  const guarded:typeof fetch=async(input,init)=>{
   controller.signal.throwIfAborted();const u=new URL(String(input)),h=new Headers(init?.headers);let kind:string;
   if(u.origin==='https://q.us-east-1.amazonaws.com'&&u.pathname==='/'&&h.get('x-amz-target')==='AmazonCodeWhispererService.ListAvailableProfiles'){check(++report.profileRequests<=3,'PROFILE_BUDGET');kind='profile';}
   else if(u.origin==='https://oidc.us-east-1.amazonaws.com'&&u.pathname==='/token'){check(++report.authRequests<=1,'AUTH_BUDGET');kind='auth';}
   else if(u.origin==='https://runtime.us-east-1.kiro.dev'&&u.pathname==='/v1/responses'&&u.search===''){
    check(report.modelRequests<3,'MODEL_BUDGET');report.modelRequests++;kind='model';check(report.modelRequests===phase,'PHASE');check(init?.method==='POST'&&init.redirect==='error'&&h.get('x-amzn-codewhisperer-optout')==='true'&&h.get('tokentype')==='SSO_OIDC'&&!h.has('x-amz-target'),'NATIVE_REQUEST');check(typeof init.body==='string'&&Buffer.byteLength(init.body)<=262144,'REQUEST_SIZE');
    const p=JSON.parse(String(init.body));check(p.model===id&&p.origin==='KIRO_CLI'&&p.stream===true&&JSON.stringify(p.reasoning)==='{"effort":"high"}','MODEL_ID');
    check(typeof p.profileArn==='string'&&h.get('x-amzn-kiro-profile')===p.profileArn,'PROFILE_HEADER');
    check(Array.isArray(p.input)&&Array.isArray(p.tools)&&p.metadata,'RESPONSES_INPUT');
    if(phase===1){conversationId=p.metadata['kiro:conversation_id'];check(typeof conversationId==='string'&&p.input.some((m:any)=>m.role==='user'&&typeof m.content==='string'&&m.content.includes(policy)&&m.content.includes(coding))&&p.tools.length===1&&p.tools[0].name==='verify_code'&&p.tools[0].type==='function','CALLER_CONTEXT');check(JSON.stringify(p.tools[0].parameters)===JSON.stringify(tool.parameters),'TOOL_SCHEMA');}
    if(phase===2){check(p.metadata['kiro:conversation_id']===conversationId&&p.input.some((m:any)=>m.role==='user'&&typeof m.content==='string'&&m.content.includes(policy)&&m.content.includes(coding)),'HISTORY');check(p.tools.length===1&&p.tools[0].name==='verify_code'&&JSON.stringify(p.tools[0].parameters)===JSON.stringify(tool.parameters),'TOOL_SCHEMA');const calls=p.input.filter((x:any)=>x.type==='function_call');check(calls.length===1&&calls[0].call_id===firstCall.id&&calls[0].name===firstCall.name&&calls[0].arguments===JSON.stringify(firstCall.arguments),'CALL_PAIR');const results=p.input.filter((x:any)=>x.type==='function_call_output');check(results.length===1&&results[0].call_id===firstCall.id,'RESULT_PAIR');const output=JSON.parse(results[0].output);check(output.status==='success'&&output.content.length===1&&output.content[0].text===JSON.stringify({passed:true,tests:10,receipt}),'RESULT_PAIR');}
    if(phase===3){const content=p.input.flatMap((m:any)=>m.role==='user'&&Array.isArray(m.content)?m.content:[]),texts=content.filter((x:any)=>x.type==='input_text'),images=content.filter((x:any)=>x.type==='input_image');check(texts.some((x:any)=>x.text.includes(policy)&&x.text.includes(vision))&&images.length===1&&images[0].image_url==='data:image/png;base64,'+imageData&&p.tools.length===0,'IMAGE_CONTEXT');}
    // Exact caller transcript/tool equality, not substring containment or membership only.
    const policyText=(text:string)=>'<system_prompt>\n'+policy+'\n</system_prompt>\n\n'+text;
    const expectedInput=phase===1?[{role:'user',content:policyText(coding)}]:phase===2?[
     {role:'user',content:policyText(coding)},...(firstAssistantText?[{role:'assistant',content:firstAssistantText}]:[]),
     {type:'function_call',call_id:firstCall.id,name:firstCall.name,arguments:JSON.stringify(firstCall.arguments)},
     {type:'function_call_output',call_id:firstCall.id,output:JSON.stringify({status:'success',content:[{text:JSON.stringify({passed:true,tests:10,receipt})}]})}
    ]:[{role:'user',content:[{type:'input_text',text:policyText(vision)},{type:'input_image',image_url:'data:image/png;base64,'+imageData}]}];
    check(JSON.stringify(p.input)===JSON.stringify(expectedInput),'EXACT_INPUT');
    check(JSON.stringify(p.tools)===JSON.stringify(phase===3?[]:[{type:'function',name:tool.name,description:tool.description,parameters:tool.parameters}]),'EXACT_TOOLS');
    report.responsesVerified=(report.responsesVerified??0)+1;
   }else throw Error('DESTINATION');
   let r:Response;
   // Preserve the actual native Responses sender (node:https), not global fetch substitution.
   if(live)r=await (kind==='model'?kiroNativeFetch:base)(input,{...init,signal:AbortSignal.any([controller.signal,...(init?.signal?[init.signal]:[])])});
   else if(kind==='profile')r=new Response(JSON.stringify({profiles:[{arn:'arn:aws:codewhisperer:us-east-1:123456789012:profile/test'}]}));
   else if(kind==='auth')throw Error('UNEXPECTED_FIXTURE_AUTH');
   else if(mode==='http-known'||mode==='http-unknown')r=new Response(JSON.stringify(mode==='http-known'?{__type:'ValidationException',reason:'kiro:model_requires_user_opt_in',param:'reasoning.type',message:'PRIVATE-ERROR'}:{__type:'PRIVATE-UNKNOWN',reason:'PRIVATE-REASON',message:'PRIVATE-ERROR'}),{status:403});
   else if(mode==='cancel'||mode==='late'){controller.abort();if(mode==='late')await new Promise(resolve=>setTimeout(resolve,30));r=sseResponse('text','late');}
   else if(mode==='stalled')r=new Response(new ReadableStream({start(){},cancel(){report.stalledCancelled=true;}}),{headers:{'content-type':'text/event-stream'}});
   else if(phase===1)r=sseResponse('tool',JSON.stringify({source:sample}),mode==='broken');
   else r=sseResponse('text',phase===2?receipt:JSON.stringify(mode==='wrong-image'?[]:expected));
   report.statuses.push({kind,status:r.status});const bounded=wrap(r,kind==='model'?98304:2097152,kind);if(controller.signal.aborted||init?.signal?.aborted){await bounded.body?.cancel();throw Error('CANCELLED');}return bounded;
  };
  const observedFetch:typeof fetch=(input,init)=>{const work=guarded(input,init);pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});return work;};
  globalThis.fetch=observedFetch; // Auxiliary profile/auth requests only; model stream explicitly uses the same guard.
  const runtime=await createModelRuntime({modelsPath,authPath,providerScope:'kiro',credentials,modelsStore,allowModelNetwork:false,refreshOnCreate:false,signal:controller.signal});
  check(!runtime.getError(),'CONFIGURATION');const restored=await runtime.refresh({providers:['kiro'],allowNetwork:false,signal:controller.signal});check(!restored.aborted&&restored.errors.size===0,'CACHE');
  if(live)check(runtime.getRegisteredNativeProvider('kiro')?.getAllModels?.().some((m:any)=>m.id===id),'NOT_IN_ACCOUNT_CATALOG');
  const model=runtime.getModel('kiro',id);check(model?.input.includes('image')&&providerRequestDefaultTransport(runtime,model)===kiroNativeFetch,'NATIVE_MODEL');
  const sessionId=randomUUID();
  const projectEvent=(event:any)=>{const allowed=['response.created','response.in_progress','response.output_item.added','response.output_item.done','response.output_text.delta','response.output_text.done','response.function_call_arguments.delta','response.function_call_arguments.done','response.reasoning_text.delta','response.reasoning_text.done','response.reasoning_summary_text.delta','response.reasoning_summary_text.done','response.reasoning_summary_part.added','response.reasoning_summary_part.done','response.content_part.added','response.content_part.done','response.completed','response.failed','response.incomplete','error'];const type=allowed.includes(event?.type)?event.type:'other';report.sseEvents[type]=(report.sseEvents[type]??0)+1;if(type==='response.completed'){report.completedModelsMatch=(report.completedModelsMatch??true)&&event.response?.model===id;const status=['completed','requires_action','failed','incomplete'].includes(event.response?.status)?event.response.status:'other';(report.completedStatuses??=[]).push(status);}};
  const call=async(ctx:any,sid:string)=>{phase++;const stream=runtime.streamSimple(model!,ctx,{fetch:observedFetch,signal:controller.signal,sessionId:sid,maxRetries:0,reasoning:undefined,timeoutMs:mode==='stalled'?30:60000,onProviderStreamEvent:projectEvent});const result=await stream.result();(report.providerEfforts??=[]).push(result.providerThinkingLevel==='high'?'high':'other');(report.offUnavailableDiagnosed??=[]).push((result.diagnostics??[]).some(d=>d.type==='kiro-thinking-off-unavailable'));report.terminals.push(['stop','toolUse','error','aborted','length'].includes(result.stopReason)?result.stopReason:'other');const codes=['invalid-sse','event-after-completion-or-missing-type','slot-reference','delta-done-mismatch','item-identity','tool-item-done-mismatch','response-terminal-mismatch','tool-final-mismatch','unknown-event','missing-completed'];for(const d of result.diagnostics??[]){if(d.type==='kiro-failure'&&d.details?.protocolCode)(report.protocolCodes??=[]).push(codes.includes(d.details.protocolCode)?d.details.protocolCode:'other');}return result;};
  const ctx:any={systemPrompt:policy,tools:[tool],messages:[{role:'user',content:coding,timestamp:1}]};
  const first=await call(ctx,sessionId);check(first.stopReason==='toolUse','TOOL_TERMINAL');const calls=first.content.filter((x:any)=>x.type==='toolCall');check(calls.length===1&&calls[0].name==='verify_code','TOOL_CALL');firstCall=calls[0];firstAssistantText=first.content.filter((x:any)=>x.type==='text').map((x:any)=>x.text).join('\n');check(testCode(firstCall.arguments.source),'CODE_TESTS');report.codingPassed=true;report.codeTests=10;report.toolCalls=1;
  const result=JSON.stringify({passed:true,tests:10,receipt});const second=await call({...ctx,messages:[...ctx.messages,first,{role:'toolResult',toolCallId:firstCall.id,toolName:firstCall.name,isError:false,timestamp:2,content:[{type:'text',text:result}]}]},sessionId);
  check(second.stopReason==='stop'&&text(second)===receipt&&!second.content.some((x:any)=>x.type==='toolCall'),'TOOL_ROUNDTRIP');report.toolRoundtripPassed=true;
  const third=await call({systemPrompt:policy,messages:[{role:'user',timestamp:1,content:[{type:'text',text:vision},{type:'image',mimeType:'image/png',data:imageData}]}]},randomUUID());
  check(third.stopReason==='stop'&&!third.content.some((x:any)=>x.type==='toolCall'),'IMAGE_TERMINAL');let actual:any;try{actual=JSON.parse(text(third));}catch{throw Error('IMAGE_ANSWER');}check(Array.isArray(actual)&&actual.length===3&&actual.every((x:any,i:number)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')==='color,shape'&&x.color===expected[i].color&&x.shape===expected[i].shape),'IMAGE_ANSWER');report.imagePassed=true;
  if(!live&&mode==='budget'){phase=4;try{await observedFetch('https://runtime.us-east-1.kiro.dev/v1/responses');throw Error('BUDGET_NOT_BLOCKED');}catch(e){check((e as Error).message==='MODEL_BUDGET','BUDGET_NOT_BLOCKED');report.budgetBlocked=true;}}
  check(verifiedEffort(report),'EFFORT_REPORT');report.passed=true;
 }catch(e){const codes=['ACCOUNT','CONFIGURATION','CACHE','NOT_IN_ACCOUNT_CATALOG','NATIVE_MODEL','TOOL_TERMINAL','TOOL_CALL','CODE_POLICY','CODE_TESTS','TOOL_ROUNDTRIP','IMAGE_TERMINAL','IMAGE_ANSWER','EFFORT_REPORT','BUDGET_NOT_BLOCKED'];report.failure=codes.includes((e as Error)?.message)?(e as Error).message:controller.signal.aborted?'CANCELLED':'HARNESS_OR_TRANSPORT';}
 finally{
  controller.abort();globalThis.fetch=original;Socket.prototype.connect=connect;let cleanupTimer:any;
  try{await Promise.race([(async()=>{await Promise.allSettled([...pending]);await Promise.all([...owned].map(f=>f()));await getGlobalDispatcher().close();report.dispatcherClosed=true;})(),new Promise((_,reject)=>{cleanupTimer=setTimeout(()=>reject(Error('CLEANUP_TIMEOUT')),4000);})]);}catch{report.cleanupFailed=true;report.passed=false;void getGlobalDispatcher().destroy().catch(()=>{});}finally{clearTimeout(cleanupTimer);clearTimeout(timer);if(!report.cleanupFailed)clearTimeout(hard);report.pendingAcquisitions=pending.size;report.configUnchanged=before.length===paths.length&&paths.every((p,i)=>readOptional(p)===before[i]);if(temp)rmSync(temp,{recursive:true,force:true});}
 }
 report.artifactUnchanged=fingerprint()===loadedFingerprint;
 report.clean=report.artifactUnchanged&&report.pendingAcquisitions===0&&report.activeBodies===0&&report.dispatcherClosed===true&&!report.cleanupFailed&&report.configUnchanged&&report.networkAttempts===0;report.passed&&=report.clean;return report;
}
async function main(){
 for(const k of ['AXIOM_EXECUTION_PROFILE','AXIOM_MODEL_ACCOUNT_BINDINGS','AXIOM_MODEL_MANAGED_ACCOUNTS','AXIOM_EXECUTION_INSTANCE','AXIOM_EXECUTION_GENERATION'])delete process.env[k];
 if(process.argv.includes('--live')){
  check(fileURLToPath(dir).startsWith('/private/tmp/axiom-sonnet05-'),'SNAPSHOT_REQUIRED');
  const proof=JSON.parse(readFileSync(new URL(caseId+'-selftest.json',evidenceDir),'utf8'));
  check(proof.passed&&proof.sha===loadedFingerprint&&proof.sha===fingerprint(),'SELFTEST_REQUIRED');save(caseId+'.claim',{consumed:true});
  const r=await run(true);save(caseId+'.json',r);console.log(JSON.stringify(r,null,2));if(!r.passed)process.exitCode=1;
 }else{
  check(!verifiedEffort({providerEfforts:['high','other','high'],offUnavailableDiagnosed:[true,true,true]})&&!verifiedEffort({providerEfforts:['high','high','high'],offUnavailableDiagnosed:[true,false,true]}),'EFFORT_ORACLE');
  check(testCode(sample),'CODE_ORACLE');let rejected=false;
  try{testCode('function mergeIntervals(a){return [];} JSON.stringify=()=>""');}catch{rejected=true;}
  check(rejected&&!testCode('function mergeIntervals(a){ JSON.stringify=()=>""; return []; }'),'CODE_ORACLE_ATTACK');
  const reports:any={};for(const m of ['good','broken','wrong-image','cancel','late','stalled','budget','http-known','http-unknown'])reports[m]=await run(false,m);
  const known=reports['http-known'],unknown=reports['http-unknown'];
  const proof={passed:reports.good.passed&&reports.budget.passed&&reports.budget.budgetBlocked&&reports.broken.failure==='TOOL_TERMINAL'&&!reports.broken.codingPassed&&!reports.broken.toolCalls&&reports.good.responsesVerified===3&&reports.good.completedModelsMatch===true&&verifiedEffort(reports.good)&&reports['wrong-image'].failure==='IMAGE_ANSWER'&&reports.cancel.failure==='TOOL_TERMINAL'&&reports.late.failure==='TOOL_TERMINAL'&&reports.stalled.failure==='TOOL_TERMINAL'&&reports.stalled.stalledCancelled===true&&known.failure==='TOOL_TERMINAL'&&known.modelRequests===1&&known.modelError?.bodyState==='json'&&known.modelError?.requiresModelOptIn===true&&JSON.stringify(known.modelError?.knownCodes)==='["ValidationException"]'&&JSON.stringify(known.modelError?.knownFields)==='["reasoning.type"]'&&unknown.failure==='TOOL_TERMINAL'&&unknown.modelError?.bodyState==='json'&&unknown.modelError?.knownCodes.length===0&&unknown.modelError?.knownFields.length===0&&unknown.modelError?.requiresModelOptIn===false&&!JSON.stringify(reports).includes('PRIVATE-')&&Object.values(reports).every((r:any)=>r.clean),sha:fingerprint(),reports};
  save(caseId+'-selftest.json',proof);writeFileSync(new URL(caseId+'-vision-fixture.png',evidenceDir),png,{flag:'wx'});
  console.log(JSON.stringify(proof,null,2));if(!proof.passed)process.exitCode=1;
 }
}
main().catch(()=>{console.log('HARNESS_GATE_FAILED');process.exitCode=1;});
