import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {WebSocket} from '../../../app/node_modules/ws/wrapper.mjs';
const dir=new URL('./',import.meta.url), ids=['claude-opus-5.5','claude-sonnet-5.5'];
const catalog=JSON.parse(readFileSync(new URL('catalog-01.json',dir),'utf8'));
if(!catalog.passed||!ids.every(id=>catalog.models.some(m=>m.id===id)))throw Error('CATALOG_REQUIRED');
writeFileSync(new URL('add-models.claim',dir),'consumed\n',{flag:'wx'});
const report={passed:false}, pending=new Map();
const ws=new WebSocket('ws://127.0.0.1:4317/ws',{origin:'http://127.0.0.1:4317'});
const timer=setTimeout(()=>{for(const p of pending.values())p.reject(Error('TIMEOUT'));ws.terminate();},45000);
ws.on('message',raw=>{try{const r=JSON.parse(String(raw)),p=pending.get(r.requestId);if(p&&r.type==='receipt'){pending.delete(r.requestId);r.ok?p.resolve(r.data):p.reject(Error('RPC_REJECTED'));}}catch{}});
const rpc=(op,params={})=>new Promise((resolve,reject)=>{const requestId=randomUUID();pending.set(requestId,{resolve,reject});ws.send(JSON.stringify({requestId,op,params}));});
const readOptional=path=>{try{return readFileSync(path,'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}};
try{
 await new Promise((r,j)=>{ws.once('open',r);ws.once('error',()=>j(Error('CONNECTION')));});
 const config=await rpc('configuration.get');
 const before=JSON.parse(readFileSync(config.storage.modelsPath,'utf8'));
 const settingsPath=join(dirname(config.storage.modelsPath),'settings.json'), settings=readOptional(settingsPath);
 const accountPath=join(dirname(config.storage.modelsPath),'model-accounts/index.json'), accounts=readOptional(accountPath);
 const provider=config.providers.find(p=>p.providerId==='kiro');if(!provider)throw Error('PROVIDER');
 const missing=ids.filter(id=>!provider.models.some(m=>m.id===id));
 for(const id of missing){const m=catalog.models.find(m=>m.id===id);provider.models.push({key:randomUUID(),id,name:m.name,levels:m.levels,input:m.input,headers:[],body:[]});}
 if(missing.length){const saved=await rpc('configuration.save',{revision:config.revision,providers:config.providers});if(saved.loggedOut?.length)throw Error('LOGOUT');}
 const reread=await rpc('configuration.get'), after=JSON.parse(readFileSync(config.storage.modelsPath,'utf8'));
 report.added=missing;report.persisted=ids.every(id=>reread.providers.find(p=>p.providerId==='kiro')?.models.some(m=>m.id===id));
 report.settingsUnchanged=settings===readOptional(settingsPath);report.accountSelectionUnchanged=accounts===readOptional(accountPath);
 report.otherProvidersUnchanged=Object.keys(before.providers).filter(k=>k!=='kiro').every(k=>JSON.stringify(before.providers[k])===JSON.stringify(after.providers[k]));
 report.proxyUnchanged=JSON.stringify(before.providers.kiro.axiomProxy)===JSON.stringify(after.providers.kiro.axiomProxy);
 report.existingModelRetained=reread.providers.find(p=>p.providerId==='kiro')?.models.some(m=>m.id==='deepseek-3.2');
 report.passed=report.persisted&&report.settingsUnchanged&&report.accountSelectionUnchanged&&report.otherProvidersUnchanged&&report.proxyUnchanged&&report.existingModelRetained;
}catch(e){report.failure=['PROVIDER','LOGOUT','TIMEOUT','RPC_REJECTED','CONNECTION'].includes(e?.message)?e.message:'LOCAL_OR_TRANSPORT';}
finally{ws.close();await new Promise(r=>{if(ws.readyState===WebSocket.CLOSED)return r();ws.once('close',r);setTimeout(()=>{ws.terminate();r();},1000).unref();});clearTimeout(timer);report.socketClosed=ws.readyState===WebSocket.CLOSED;writeFileSync(new URL('add-models.json',dir),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;}
