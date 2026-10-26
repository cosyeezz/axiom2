// Local read-only supplement: no model selection, prompt, stop, reload, or writes to raw state.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { hydrateToolCalls, assertControlledTools, assertControlledAnswer } from '../../app/scripts/kiro-live-plan.mjs';
import { assertControlledTools as originalToolRule } from './plan-before-argument-hydration.mjs';
const { WebSocket } = createRequire(new URL('../../app/package.json',import.meta.url))('ws');
const source = new URL('./recovery-continuation-v3/qwen3-coder-next/state.json',import.meta.url);
const bytes = readFileSync(source), state = JSON.parse(bytes), turn = state.turns.find(t=>t.label==='long-10-write-read');
const hash = x=>createHash('sha256').update(x).digest('hex');
assert.equal(turn.run.status,'completed');assert.equal(turn.inputCorrelated,true);
assert.equal(hash(readFileSync(new URL('./plan-before-argument-hydration.mjs',import.meta.url))),state.harness.sourceHashes.find(x=>x.path.endsWith('kiro-live-plan.mjs')).sha256);
const origin='http://127.0.0.1:4317',scope={workspaceId:state.workspaceId,sessionId:state.sessionId};
const pending=new Map(),snapshots=new Map(),ws=new WebSocket(origin.replace('http:','ws:')+'/ws',{headers:{Origin:origin}});
ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='snapshot')snapshots.set(m.scope,m.data);
 if(m.type==='receipt'){const p=pending.get(m.requestId);if(p){pending.delete(m.requestId);clearTimeout(p.timer);m.ok?p.resolve(m.data):p.reject(new Error(m.error?.code??'READ_FAILED'));}}});
async function call(op,params={},to=scope){const requestId=randomUUID();const result=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(requestId);reject(new Error('READ_ONLY_TIMEOUT'));},15000);pending.set(requestId,{resolve,reject,timer});});ws.send(JSON.stringify({requestId,op,params,...to}));return result;}
try {
 await once(ws,'open');
 const key='tasks:'+state.workspaceId+':'+state.parentSessionId;await call('subscribe',{scope:key},{});
 const task=snapshots.get(key).tasks.find(t=>t.ref===state.taskRef);assert.equal(task.id,state.taskId);assert.equal(task.sessionId,state.sessionId);
 assert.ok(task.inputs.every(i=>i.state==='delivered'));
 assert.equal(task.inputs.filter(i=>(i.id??i.inputId)===turn.receipt.inputId).length,1,'Durable receipt must remain in this owned task');
 const messages=(await call('agent.original')).filter(m=>m.runId===turn.run.id);
 const users=messages.filter(m=>m.role==='user'&&m.inputIds?.includes(turn.receipt.inputId));assert.equal(users.length,1);assert.equal(users[0].inputIds.length,1);
 const user=users[0],userText=user.truncated?(await call('message.part',{id:user.id,field:'text'})).text:user.text;assert.ok(userText.includes(turn.prompt));
 const assistant=messages.filter(m=>m.role==='assistant');
 assert.deepEqual(assistant.map(m=>m.id),turn.messageIds.filter(m=>m.role==='assistant').map(m=>m.id));
 const details=[];const fullCalls=(await Promise.all(assistant.map(m=>hydrateToolCalls(m,async params=>{
   const detail=await call('message.part',params);details.push({messageId:params.id,callId:params.callId});return detail;
 })))).flat();
 assert.equal(fullCalls.length,turn.calls.length);
 for(const c of fullCalls){const old=turn.calls.find(x=>x.id===c.id);assert.ok(old&&old.messageId===c.messageId&&old.name===c.name);assert.ok(c.input.startsWith(old.input));}
 const complete={...turn,calls:fullCalls},context={root:'F:/Axiom/axiom2/test-results/kiro-long-session/workspace',modelId:'qwen3-coder-next',
 receiptPath:'F:/Axiom/axiom2/test-results/kiro-long-session/workspace/matrix/qwen3-coder-next/receipt-recovery-v3.json',cwd:'F:/Axiom/axiom2'};
 const observe=fn=>{try{fn();return{passed:true};}catch(e){return{passed:false,errorSha256:hash(String(e.message))};}};
 const legacy=observe(()=>originalToolRule(turn.label,complete,context)),repaired=observe(()=>assertControlledTools(turn.label,complete,context));
 assertControlledAnswer(turn.label,turn,{vision:false});assert.equal(hash(readFileSync(source)),hash(bytes));
 const evidence={schemaVersion:1,phase:'posthoc-complete-tool-input-observation',model:'qwen3-coder-next',taskRef:state.taskRef,label:turn.label,
 runId:turn.run.id,status:turn.run.status,selection:turn.run.selection,observedAt:new Date().toISOString(),
 promptCorrelation:{inputIdSha256:hash(turn.receipt.inputId),singleUserInputMatched:true,actualCompletePromptMatchedAtPosthocObservation:true,durableReceiptDelivered:true},
 originalState:{sha256:hash(bytes),unchanged:true,originalCheckPassed:state.checks.find(c=>c.label===turn.label).passed,originalSemanticFailureCount:state.checkFailures.length},
 observation:{callCount:fullCalls.length,completeDetailReadCount:details.length,allOriginalMessageCallIdentitiesMatched:true,allLengthPrefixAndRevisionChecksPassed:true},
 calls:fullCalls.map(c=>({name:c.name.replace(/^functions\./,''),callIdSha256:hash(c.id),messageIdSha256:hash(c.messageId),argumentsSha256:hash(c.input),
 previousProjectionSha256:hash(turn.calls.find(x=>x.id===c.id).input),inputLength:c.inputLength,fullInputRead:c.fullInputRead})),
 checks:{originalRuleWithHydratedInputs:legacy,recoveryAwareRuleWithHydratedInputs:repaired,unchangedAnswerSchemaPassed:true},
 counting:{includedAsAnotherMatrixRound:false,retroactivelyChangedOriginalScore:false,newModelRequests:0},
 sourceHashes:{originalPlan:state.harness.sourceHashes.find(x=>x.path.endsWith('kiro-live-plan.mjs')).sha256,
 publishedPlan:hash(readFileSync(new URL('../../app/scripts/kiro-live-plan.mjs',import.meta.url)))},
 contentPolicy:'No prompt/answer/thinking, full tool arguments/results, session identity, credentials or local transcript name.'};
 writeFileSync(new URL('../../docs/evidence/kiro-long-session/qwen-tool-input-supplement.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({posthoc:true,callCount:fullCalls.length,detailReadCount:details.length,originalRulePassed:legacy.passed,repairedRulePassed:repaired.passed,
 originalScoreUnchanged:true,newModelRequests:0}));
} finally {for(const p of pending.values())clearTimeout(p.timer);ws.close();}
