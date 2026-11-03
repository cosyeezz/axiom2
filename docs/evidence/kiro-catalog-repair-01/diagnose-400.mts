import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fetchKiroCatalog } from '../../../app/src/native-providers/kiro/catalog.js';
import { readModelCredential } from '../../../app/src/server/model-account-storage.js';
import { getGlobalDispatcher } from '../../../app/node_modules/undici/index.js';
const dir=new URL('./',import.meta.url);
const project=(text:string)=>{
 let body:any={};try{body=JSON.parse(text);}catch{}
 const types=['ValidationException','InvalidRequestException','AccessDeniedException','UnauthorizedException'];
 const type=String(body.__type??body.code??body.type??'').split('#').at(-1);
 return {type:types.includes(type!)?type:'other',profileRequired:/profile.{0,100}(required|missing)|(required|missing).{0,100}profile/i.test(text),originInvalid:/origin.{0,100}(invalid|unsupported)|(invalid|unsupported).{0,100}origin/i.test(text),tokenInvalid:/(token|bearer).{0,100}(invalid|expired)|(invalid|expired).{0,100}(token|bearer)/i.test(text)};
};
async function main(){
 if(!project('{"message":"profileArn is required for this request."}').profileRequired||project('PRIVATE').profileRequired)throw Error('SELFTEST');
 if(process.argv[2]!=='--live'){console.log('selftest passed');return;}
 for(const k of ['AXIOM_EXECUTION_PROFILE','AXIOM_MODEL_ACCOUNT_BINDINGS','AXIOM_MODEL_MANAGED_ACCOUNTS'])delete process.env[k];
 writeFileSync(new URL('diagnose-400.claim',dir),'consumed\n',{flag:'wx'});
 const report:any={requests:0,status:0,success:false};
 const save=()=>writeFileSync(new URL('diagnose-400.json',dir),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 const hard=setTimeout(()=>{report.hardTimeout=true;save();process.exit(1);},20000);
 try {
  const {configureModelNetwork}=await import('../../../app/src/server/integrations/model-proxy-env.js');
  configureModelNetwork(join(homedir(),'Library/Application Support/Axiom2'),join(homedir(),'.pi/agent/models.json'),'kiro');
  const account=readModelCredential('kiro',join(homedir(),'.pi/agent/auth.json'));
  await fetchKiroCatalog(account,AbortSignal.timeout(15000),async(input,init)=>{
   const u=new URL(String(input));if(report.requests++>=1||u.origin!=='https://management.us-east-1.kiro.dev'||new Headers(init?.headers).get('x-amz-target')!=='KiroControlPlaneBearerService.ListAvailableModels')throw Error('BUDGET');
   const response=await fetch(input,init);report.status=response.status;
   const reader=response.body!.getReader();let size=0;const chunks:Uint8Array[]=[];
   try{for(;;){const v=await reader.read();if(v.done)break;size+=v.value.length;if(size>16384)throw Error('CAP');chunks.push(v.value);}const text=Buffer.concat(chunks).toString('utf8');Object.assign(report,project(text));return new Response(text,{status:response.status,headers:response.headers});}
   finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  });report.success=true;
 }catch{report.failure='catalog-failed';}
 finally{await getGlobalDispatcher().close();report.dispatcherClosed=true;clearTimeout(hard);save();}
 console.log(JSON.stringify(report));
}
main().catch(()=>{console.log('diagnostic-gate-failed');process.exitCode=1;});
