import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { WebSocket } from '../../../app/node_modules/ws/wrapper.mjs';
import { readModelCredential } from '../../../app/dist/server/model-account-storage.js';
for (const k of ['AXIOM_EXECUTION_PROFILE','AXIOM_MODEL_ACCOUNT_BINDINGS','AXIOM_MODEL_MANAGED_ACCOUNTS','AXIOM_EXECUTION_INSTANCE','AXIOM_EXECUTION_GENERATION']) delete process.env[k];
const dir=new URL('./',import.meta.url), live=process.argv.includes('--live');
const save=(name,value)=>writeFileSync(new URL(name,dir),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
const check=(ok,code)=>{if(!ok)throw Error(code);};
if(live){check(JSON.parse(readFileSync(new URL('preflight.json',dir))).passed,'PREFLIGHT_REQUIRED');save('catalog-01.claim',{consumed:true});}
const report={passed:false,catalogRpcCount:0};
const ws=new WebSocket('ws://127.0.0.1:4317/ws',{origin:'http://127.0.0.1:4317',maxPayload:4*1024*1024});
const waiting=new Map();
const timer=setTimeout(()=>{for(const p of waiting.values())p.reject(Error('DEADLINE'));ws.terminate();},45000);
const hard=setTimeout(()=>process.exit(2),50000);
ws.on('message',raw=>{try{const r=JSON.parse(String(raw));const p=waiting.get(r.requestId);if(!p||r.type!=='receipt')return;waiting.delete(r.requestId);if(r.ok)p.resolve(r.data);else p.reject(Error('RPC_REJECTED'));}catch{for(const p of waiting.values())p.reject(Error('BAD_RESPONSE'));}});
const rpc=(op,params={})=>new Promise((resolve,reject)=>{const requestId=randomUUID();waiting.set(requestId,{resolve,reject});ws.send(JSON.stringify({requestId,op,params}));});
try{
 await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',()=>reject(Error('CONNECTION')));});
 const config=await rpc('configuration.get');
 check(config.storage?.modelsPath&&config.storage?.authPath,'STORAGE');
 const before=readFileSync(config.storage.modelsPath,'utf8');
 const account=readModelCredential('kiro',config.storage.authPath);
 const provider=config.providers.find(p=>p.providerId==='kiro');
 report.enterprise=account?.type==='oauth'&&account.authMethod==='identity-center';
 report.noEndpointOverride=!!provider&&!JSON.parse(before).providers?.kiro?.baseUrl;
 report.oauthFresh=!!account&&account.expires>Date.now()+330000;
 report.configuredIds=provider?.models.map(m=>m.id)??[];
 check(report.enterprise&&report.noEndpointOverride,'ACCOUNT_OR_ENDPOINT');
 if(live){
  report.catalogRpcCount++;
  const catalog=await rpc('configuration.catalog',{providerId:'kiro',revision:config.revision});
  check(['native','refreshed'].includes(catalog.source)&&Array.isArray(catalog.models)&&catalog.models.length>0,'NOT_LIVE_CATALOG');
  report.source=catalog.source;
  report.models=catalog.models.map(m=>({id:m.id,name:m.name,input:m.input,levels:m.levels}));
  report.count=report.models.length;
  report.requestedMatches=report.models.filter(m=>/(opus|sonnet)[- .]?5[.-]5/i.test(m.id+' '+m.name));
 }
 report.configUnchanged=before===readFileSync(config.storage.modelsPath,'utf8');
 check(report.configUnchanged,'CONFIG_CHANGED');report.passed=true;
}catch(e){report.failure=['STORAGE','ACCOUNT_OR_ENDPOINT','NOT_LIVE_CATALOG','CONFIG_CHANGED','RPC_REJECTED','BAD_RESPONSE','CONNECTION','DEADLINE'].includes(e?.message)?e.message:'LOCAL_OR_TRANSPORT';}
finally{
 ws.close();await new Promise(resolve=>{if(ws.readyState===WebSocket.CLOSED)return resolve();ws.once('close',resolve);setTimeout(()=>{ws.terminate();resolve();},1000).unref();});
 clearTimeout(timer);clearTimeout(hard);report.socketClosed=ws.readyState===WebSocket.CLOSED;
 save(live?'catalog-01.json':'preflight.json',report);console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
}
