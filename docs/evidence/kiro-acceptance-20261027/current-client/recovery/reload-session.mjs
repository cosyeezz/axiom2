import { WebSocket } from '/Volumes/D_Work/axiom2/app/node_modules/ws/wrapper.mjs';
import { randomUUID } from 'node:crypto';
import { writeFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
const file='/tmp/kiro-client-rea-20261027/recovery/reload-request.json';
assert(!existsSync(file),'Existing request: inspect, never replay');
const scope={workspaceId:'b64c057e-96ee-435a-a078-a501e8f0d128',sessionId:'a6f690d3-39a6-47f8-9cdd-3fe804730184'};
const ws=new WebSocket('ws://127.0.0.1:4317/ws',{headers:{Origin:'http://127.0.0.1:4317'}});
const pending=new Map();const snapshots=new Map();
ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='snapshot')snapshots.set(m.scope,m.data);if(m.type==='receipt'){const p=pending.get(m.requestId);if(p){clearTimeout(p.timer);pending.delete(m.requestId);m.ok?p.resolve(m.data):p.reject(Error(JSON.stringify(m.error)));}}});
function call(op,params={},customId=randomUUID()){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Receipt timeout; inspect before retry')),15000);pending.set(customId,{resolve,reject,timer});ws.send(JSON.stringify({requestId:customId,op,...scope,params}));});}
await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)});
try {
 const cat=await call('capabilities.get'); assert(cat.state.selection?.mcp.includes('rea'));
 const capabilities={target:'session',revision:cat.state.revision,catalogRevision:cat.revision,skills:cat.state.selection.skills,mcp:cat.state.selection.mcp};assert(Array.isArray(capabilities.skills));
 const reloadKey=`reload:${scope.workspaceId}:${scope.sessionId}`;await call('subscribe',{scope:reloadKey});const previous=snapshots.get(reloadKey);assert(previous?.status!=='running','Do not duplicate active reload');
 const requestId=randomUUID(), record={createdAt:new Date().toISOString(),requestId,...scope,capabilities,previous:previous&&{id:previous.id,status:previous.status,endedAt:previous.endedAt}};
 writeFileSync(file,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
 record.receipt=await call('agent.reload',{capabilities},requestId);writeFileSync(file,JSON.stringify(record,null,2)+'\n');
 console.log(JSON.stringify({requestId,receipt:record.receipt,file,warning:'Receipt is admission only; inspect after safe-point reload before any analysis.'}));
} finally {for(const p of pending.values())clearTimeout(p.timer);ws.close();}
