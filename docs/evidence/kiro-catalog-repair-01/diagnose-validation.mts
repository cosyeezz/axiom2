import {writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fetchKiroCatalog} from '../../../app/src/native-providers/kiro/catalog.js';
import {readModelCredential} from '../../../app/src/server/model-account-storage.js';
import {getGlobalDispatcher} from '../../../app/node_modules/undici/index.js';
const dir=new URL('./',import.meta.url);
const terms=['profile','arn','origin','token','type','bearer','header','null','empty','missing','required','constraint','length','enum','invalid','format','subscription','access','permission','SSO_OIDC','KIRO_CLI','content','body','request','member','parameter','maxResults','nextToken','Account','IdC'];
const project=(s:string)=>Object.fromEntries(terms.map(word=>[word,s.toLowerCase().includes(word.toLowerCase())]));
async function main(){
 if(!project('Profile ARN cannot be null').profile||!project('Profile ARN cannot be null').null||project('secret').token)throw Error('SELFTEST');
 if(process.argv[2]!=='--live'){console.log('selftest passed');return;}
 for(const k of ['AXIOM_EXECUTION_PROFILE','AXIOM_MODEL_ACCOUNT_BINDINGS','AXIOM_MODEL_MANAGED_ACCOUNTS'])delete process.env[k];
 writeFileSync(new URL('diagnose-validation.claim',dir),'consumed\n',{flag:'wx'});
 const r:any={requests:0,status:0};const save=()=>writeFileSync(new URL('diagnose-validation.json',dir),JSON.stringify(r,null,2)+'\n',{flag:'wx'});
 const hard=setTimeout(()=>{r.hardTimeout=true;save();process.exit(1);},20000);
 try{
  const {configureModelNetwork}=await import('../../../app/src/server/integrations/model-proxy-env.js');
  configureModelNetwork(join(homedir(),'Library/Application Support/Axiom2'),join(homedir(),'.pi/agent/models.json'),'kiro');
  await fetchKiroCatalog(readModelCredential('kiro',join(homedir(),'.pi/agent/auth.json')),AbortSignal.timeout(15000),async(input,init)=>{
   if(r.requests++>=1||new URL(String(input)).origin!=='https://management.us-east-1.kiro.dev')throw Error('BUDGET');
   const res=await fetch(input,init);r.status=res.status;const reader=res.body!.getReader(),chunks:Uint8Array[]=[];let size=0;
   try{for(;;){const v=await reader.read();if(v.done)break;size+=v.value.length;if(size>16384)throw Error('CAP');chunks.push(v.value);}const text=Buffer.concat(chunks).toString('utf8');r.terms=project(text);return new Response(text,{status:res.status});}
   finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  });
 }catch{r.catalogFailed=true;}
 finally{await getGlobalDispatcher().close();r.dispatcherClosed=true;clearTimeout(hard);save();}
 console.log(JSON.stringify(r));
}
main().catch(()=>{console.log('diagnostic-gate-failed');process.exitCode=1;});
