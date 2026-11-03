import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const dir=dirname(fileURLToPath(import.meta.url));
export const provider='codebuddy-cn',modelId='deepseek-v4.1-flash',origin='https://copilot.tencent.com';
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export class SafeFailure extends Error {constructor(code){super(code);this.code=code;}}
export function check(ok,code){if(!ok)throw new SafeFailure(code);}
export function frozenRuntime(){
  const manifest=readFileSync(join(dir,'../codebuddy-native-component-live-01/FROZEN-RUNTIME.json'));
  check(sha(manifest)==='8268cb1958cabddf17c6b3f8816a3b4e0a112c62156b342fe3fbfde9c44ea753','SNAPSHOT_MANIFEST');
  const frozen=JSON.parse(manifest);check([...frozen.files,...frozen.artifacts].every(file=>sha(readFileSync(join(frozen.snapshotRoot,file.path)))===file.sha256),'SNAPSHOT_FILES');return frozen;
}
export async function modules(){const frozen=frozenRuntime(),root=frozen.snapshotRoot;const compiled=name=>import(pathToFileURL(join(root,'app/dist',name)).href),load=name=>import(pathToFileURL(join(root,'app/node_modules',name,'dist/index.js')).href);
  return {root,compiled,require:createRequire(join(root,'app/package.json')),...await compiled('server/model-runtime.js'),...await compiled('server/model-account-storage.js'),...await compiled('native-providers/codebuddy/http.js'),...await compiled('server/codebuddy-run-identity.js'),...await compiled('server/provider-request-observer.js'),...await load('@earendil-works/pi-ai'),...await load('@earendil-works/pi-agent-core')};
}
export function configPaths(){const root=process.env.AXIOM_PI_DIR||join(homedir(),'.pi/agent');return {authPath:join(root,'auth.json'),modelsPath:join(root,'models.json'),settingsPath:join(root,'settings.json')};}
export function configSnapshot(){const p=configPaths();return [p.modelsPath,p.settingsPath].map(path=>existsSync(path)?readFileSync(path,'utf8'):undefined);}
export const unchanged=snapshot=>JSON.stringify(snapshot)===JSON.stringify(configSnapshot());
export function cleanBindings(){for(const key of ['AXIOM_EXECUTION_PROFILE','AXIOM_MODEL_ACCOUNT_BINDINGS','AXIOM_MODEL_MANAGED_ACCOUNTS','AXIOM_EXECUTION_INSTANCE','AXIOM_EXECUTION_GENERATION'])delete process.env[key];}
export async function openRuntime({live,temporary,state,metadataOnly=false}){
  cleanBindings();const m=await modules(),paths=configPaths();let runtime,dispatcher,credentials;
  const originalFetch=globalThis.fetch;
  if(live&&!metadataOnly){const network=await m.compiled('server/integrations/model-proxy-env.js');check(network.readProviderProxy(paths.modelsPath,provider).mode==='direct','PROXY_NOT_DIRECT');const {dataRoot}=await m.compiled('server/data-root.js');network.configureModelNetwork(dataRoot(),paths.modelsPath,provider);dispatcher=(await import(pathToFileURL(m.require.resolve('undici')).href)).getGlobalDispatcher();}
  const fetchBeforeGate=globalThis.fetch;
  globalThis.fetch=async(input,init)=>{
    check(!metadataOnly,'METADATA_NETWORK');
    check(String(input)===origin+'/v2/plugin/auth/token/refresh'&&init?.method==='POST'&&init?.body==='{}','AUTH_DESTINATION');
    check(state.refreshRequests++===0,'REFRESH_BUDGET');check(init.signal,'REFRESH_OWNER_SIGNAL');
    if(live){try{writeFileSync(join(dir,'../codebuddy-cli-compare-01/refresh-live-claim.json'),JSON.stringify({requests:1,parentPid:process.pid})+'\n',{flag:'wx',mode:0o600});}catch{check(false,'SHARED_REFRESH_BUDGET');}}
    // This owner signal is Pi's. Do not combine it with caller cancellation.
    const response=live?await fetchBeforeGate(input,{...init,redirect:'error'}):Response.json({code:0,data:{accessToken:'SYNTHETIC-ACCESS',refreshToken:'SYNTHETIC-ROTATED',expiresIn:3600}});
    state.refreshStatus=response.status;if(!response.ok){await response.body?.cancel().catch(()=>{});check(false,'REFRESH_HTTP');}const reader=response.body?.getReader();check(reader,'REFRESH_BODY');let size=0;
    return new Response(new ReadableStream({async pull(controller){try{const part=await reader.read();if(part.done){reader.releaseLock();controller.close();return;}size+=part.value.length;check(size<=1048576,'REFRESH_BYTES');controller.enqueue(part.value);}catch(error){await reader.cancel().catch(()=>{});controller.error(error);}},async cancel(){await reader.cancel().catch(()=>{});}}),{status:response.status,headers:response.headers});
  };
  try {
    if(live)runtime=await m.createModelRuntime({...paths,providerScope:provider,metadataOnly,refreshOnCreate:false,allowModelNetwork:false});
    else {credentials=new m.InMemoryCredentialStore();await credentials.modify(provider,async()=>({type:'oauth',access:'SYNTHETIC-OLD',refresh:'SYNTHETIC-REFRESH',expires:Date.now()-1000}));const modelsPath=join(temporary,'models.json');writeFileSync(modelsPath,'{"providers":{}}',{flag:'wx',mode:0o600});runtime=await m.createModelRuntime({providerIds:[provider],credentials,modelsStore:new m.InMemoryModelsStore(),modelsPath,authPath:join(temporary,'auth.json'),refreshOnCreate:false});}
    check(!runtime.getError(),'MODEL_CONFIGURATION');const model=runtime.getModel(provider,modelId);check(model?.api==='openai-completions'&&model?.baseUrl===origin+'/v2','MODEL_SELECTION');check(m.providerRequestDefaultTransport(runtime,model)===m.codeBuddyNativeFetch,'NATIVE_SENDER');
    const readCredential=()=>live?m.readModelCredential(provider,paths.authPath):credentials.read(provider);
    if(!metadataOnly)await runtime.getAuth(model);
    const credential=await readCredential();check(credential?.type==='oauth'&&!!credential.access&&!!credential.refresh,'OAUTH_ROUTE');if(!metadataOnly)check(credential.expires>Date.now()+120000,'TOKEN_EXPIRY');
    state.oauthRoute=true;state.nativeSender=true;
    return {m,runtime,model,readCredential,access:credential.access,sessionId:randomUUID(),runId:randomUUID(),async close(){runtime.getRegisteredNativeProvider(provider)?.dispose();if(dispatcher)await dispatcher.close();globalThis.fetch=originalFetch;state.runtimeDisposed=true;}};
  } catch(error){runtime?.getRegisteredNativeProvider(provider)?.dispose();if(dispatcher)await dispatcher.close();globalThis.fetch=originalFetch;throw error;}
}
