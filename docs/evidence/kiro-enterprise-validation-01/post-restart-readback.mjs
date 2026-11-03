import {writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {WebSocket} from '../../../app/node_modules/ws/wrapper.mjs';
const dir=new URL('./',import.meta.url),requestId=randomUUID(),report={passed:false,rpcCalls:0};
writeFileSync(new URL('post-restart-readback.claim',dir),'consumed\n',{flag:'wx'});
const ws=new WebSocket('ws://127.0.0.1:4317/ws',{origin:'http://127.0.0.1:4317'});
let timer;
try{
 const config=await new Promise((resolve,reject)=>{
  timer=setTimeout(()=>reject(Error('TIMEOUT')),10000);
  ws.once('error',()=>reject(Error('CONNECTION')));
  ws.once('open',()=>{report.rpcCalls++;ws.send(JSON.stringify({requestId,op:'configuration.get',params:{}}));});
  ws.on('message',raw=>{try{const r=JSON.parse(String(raw));if(r.requestId===requestId&&r.type==='receipt'){r.ok?resolve(r.data):reject(Error('RPC_REJECTED'));}}catch{reject(Error('RESPONSE'));}});
 });
 const p=config.providers.find(p=>p.providerId==='kiro');
 report.opusPresent=p?.models.some(m=>m.id==='claude-opus-5.5')===true;
 report.sonnetPresent=p?.models.some(m=>m.id==='claude-sonnet-5.5')===true;
 report.deepseekRetained=p?.models.some(m=>m.id==='deepseek-3.2')===true;
 report.passed=report.opusPresent&&report.sonnetPresent&&report.deepseekRetained;
}catch(e){report.failure=['TIMEOUT','CONNECTION','RPC_REJECTED','RESPONSE'].includes(e?.message)?e.message:'LOCAL';}
finally{
 clearTimeout(timer);ws.close();await new Promise(resolve=>{if(ws.readyState===WebSocket.CLOSED)return resolve();ws.once('close',resolve);setTimeout(()=>{ws.terminate();resolve();},1000).unref();});
 report.socketClosed=ws.readyState===WebSocket.CLOSED;report.passed&&=report.socketClosed;
 writeFileSync(new URL('post-restart-readback.json',dir),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;
}
