import WebSocket from '../../app/node_modules/ws/wrapper.mjs';
import { writeFileSync } from 'node:fs';
const port=4317,origin=`http://127.0.0.1:${port}`;
const ws=new WebSocket(origin.replace('http:','ws:')+'/ws',{origin,handshakeTimeout:3000});
try {
 await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)});
 let seq=0;const command=(op,params)=>new Promise((resolve,reject)=>{const requestId=`buddy-status-${++seq}`;const t=setTimeout(()=>reject(Error('RPC timeout')),5000);const listener=(raw)=>{const v=JSON.parse(raw.toString());if(v.requestId===requestId){clearTimeout(t);ws.off('message',listener);v.ok?resolve(v.data):reject(Error(JSON.stringify(v.error)));}};ws.on('message',listener);ws.send(JSON.stringify({requestId,op,params}));});
 const config=await command('configuration.get');
 const result={checkedAt:new Date().toISOString(),port,revision:config.revision,providers:config.providers.map(p=>({id:p.id,name:p.name,configured:p.auth?.configured,modelCount:p.models?.length??0})),targetTemplates:config.templates.filter(t=>/buddy/i.test(t.id+' '+t.name)).map(t=>({id:t.id,name:t.name,methods:t.methods})),templateCount:config.templates.length};
 writeFileSync(new URL('./axiom-main-status.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{ws.terminate()}
