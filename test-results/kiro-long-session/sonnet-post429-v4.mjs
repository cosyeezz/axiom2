// Local single-use follow-up. No failed input or side-effecting tool is replayed.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, openSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { controlledPrompt, controlledFormat, assertControlledAnswer, assertControlledTools } from '../../app/scripts/kiro-live-plan.mjs';
const app = 'F:/Axiom/axiom2/app', root = 'F:/Axiom/axiom2/test-results/kiro-long-session/sonnet-post429-v4';
const priorPath = 'F:/Axiom/axiom2/test-results/kiro-long-session/recovery-continuation-v3/claude-sonnet-4.5/state.json';
const priorBytes = readFileSync(priorPath), prior = JSON.parse(priorBytes), failed = prior.turns.at(-1);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(failed.label, 'long-17-shell-recovery'); assert.equal(failed.run.status, 'failed'); assert.match(failed.run.error, /HTTP\s*429/);
assert.equal(prior.completedAt, undefined);
const fixtureRoot = 'F:/Axiom/axiom2/test-results/kiro-long-session/workspace', receiptPath = fixtureRoot + '/matrix/claude-sonnet-4.5/receipt-recovery-v3.json';
assertControlledTools(failed.label, failed, { root: fixtureRoot, modelId: 'claude-sonnet-4.5', receiptPath });
const gate = JSON.parse(readFileSync('F:/Axiom/axiom2/test-results/kiro-long-session/recovery-continuation-v3/quiescence-after-final.json','utf8'));
assert.ok(gate.allOwnedTasksQuiescent && gate.defaultsUnchanged && gate.hashChecks.every(x=>x.unchanged));
assert.ok(!existsSync(root), 'Single-use follow-up root must not exist'); mkdirSync(root);
const files = ['src/server/providers/kiro-chat-protocol.ts','src/server/providers/kiro-chat.ts','scripts/kiro-live-check.mjs','scripts/kiro-live-plan.mjs','dist/server/providers/kiro-chat-protocol.js','dist/server/providers/kiro-chat.js'];
const hashes = () => files.map(path=>({path,sha256:hash(readFileSync(app+'/'+path))}));
const oldSummary = JSON.parse(readFileSync('F:/Axiom/axiom2/test-results/kiro-long-session/recovery-continuation-v3/summary.json','utf8'));
const notBefore = Date.parse(oldSummary.finishedAt) + 300_000;
const summary = { attempt:'sonnet-post429-v4', startedAt:new Date().toISOString(), pid:process.pid,
  policy:{maximumNewPrompts:4,minimumCooldownMs:300000,promptPaceMs:30000,noPriorInputReplay:true,noPriorToolReplay:true,stopOnAnyProtocolFailure:true},
  notBefore:new Date(notBefore).toISOString(), priorFailedRunId:failed.run.id, priorSourceSha256:hash(priorBytes), codeHashes:hashes(), rounds:[] };
const harness = {...prior.harness, receiptTag:'post429-followup-v4',sourceHashes:['kiro-live-check.mjs','kiro-live-plan.mjs'].map(name=>({path:'app/scripts/'+name,sha256:hash(readFileSync(app+'/scripts/'+name))}))};
delete harness.workerPreparation;
let state = { workspaceId:prior.workspaceId,parentSessionId:prior.parentSessionId,taskRef:prior.taskRef,taskId:prior.taskId,sessionId:prior.sessionId,
  defaults:prior.defaults,selection:prior.selection,createdAt:new Date().toISOString(),turns:[],checks:[],checkFailures:[],harness,
  followup:{priorSourceSha256:hash(priorBytes),priorFailedRunId:failed.run.id,startLabel:failed.label,priorToolEvidenceValidated:true,
    replayPolicy:'new-inputs-no-prior-tools-repeated',fixtureRoot,receiptPath} };
const statePath = root+'/state.json', save = () => {writeFileSync(statePath,JSON.stringify(state,null,2)+'\n');writeFileSync(root+'/summary.json',JSON.stringify(summary,null,2)+'\n');};
save();
async function command(label, args) {
 const fd=openSync(root+'/'+label+'.log','wx');let code;
 try {code=await new Promise((resolve,reject)=>{const p=spawn(process.execPath,args,{cwd:app,stdio:['ignore',fd,fd],windowsHide:true});p.once('error',reject);p.once('close',c=>resolve(c??125));});}
 finally {closeSync(fd);}
 writeFileSync(root+'/'+label+'.exit-code.txt',String(code)+'\n',{flag:'wx'});return code;
}
const plan = [
 ['long-17-shell-recovery','medium','这是上轮HTTP 429之后的一条新输入，不重发先前输入，也不得重复工具。前一轮受控PowerShell故意throw和随后的read都已返回。本轮禁止任何工具，只根据已有真实工具结果列出刚读到的文件值。回复以RECOVERED_JSON开头，后接JSON对象，字段marker、checkword、total。不要复述工具内容。'],
 ['long-18-unicode','medium','不调用工具。只输出有效JSON，字段word为最初的中文校验词，quote为字符串 a"b，path为字符串 C:\\probe\\receipt.json，emoji为青鸟表情 🐦。不要用markdown代码围栏。'],
 ['long-19-final-ledger','high','不调用工具。只依靠本会话历史，输出JSON：最初标记/校验词/乘法结果、磁盘库存三色和总数、会话增加的颜色与新总数、两份附件的关键码与数值及合计。保留原数字，不要重新读文件。'],
 ['long-20-checksum','high','不调用工具。最后算一个校验：最初的乘法结果 + 磁盘库存总数 + 当前会话库存总数 + 两份附件关键值之和。只回复最初标记、校验词和这个总和，一行。'],
];
let lastPromptAt=0;
try {
 await delay(Math.max(0,notBefore-Date.now()));
 assert.deepEqual(hashes(),summary.codeHashes);
 for (const f of harness.fixtures) assert.equal(hash(readFileSync(fixtureRoot+'/'+f.name)),f.sha256);
 assert.equal(await command('preflight',['../test-results/kiro-long-session/verify-tail-quiescence.mjs','--preflight']),0);
 for (const [label,thinking,text] of plan) {
  assert.deepEqual(hashes(),summary.codeHashes);
  assert.equal(await command(label+'-select',['scripts/kiro-live-check.mjs','select','--model','claude-sonnet-4.5','--thinking',thinking,'--state',statePath]),0);
  await delay(Math.max(0,30000-(Date.now()-lastPromptAt)));lastPromptAt=Date.now();
  const promptPath=root+'/'+label+'.prompt.txt';
  writeFileSync(promptPath,label==='long-17-shell-recovery'?text:controlledPrompt(label,text,true),{flag:'wx'});
  const code=await command(label,['scripts/kiro-live-check.mjs','send','--controlled-prompts','--state',statePath,'--label',label,'--prompt-file',promptPath]);
  state=JSON.parse(readFileSync(statePath,'utf8'));const turn=state.turns.at(-1);
  summary.rounds.push({label,exitCode:code,runId:turn?.run?.id??null,status:turn?.run?.status??null});
  assert.ok(turn&&turn.label===label,'No attribution: never replay');
  if (code!==0||turn.run.status!=='completed'){summary.stoppedOnProtocolFailure=true;save();break;}
  assert.equal(turn.run.selection.thinking,thinking);
  turn.format=controlledFormat(label,turn.answer);
  try {assertControlledAnswer(label,turn,{vision:true});assert.equal(turn.calls.length,0,'Follow-up must not repeat prior tools');assert.equal(turn.results.length,0);state.checks.push({label,passed:true});}
  catch(error){const f={label,passed:false,error:String(error.message)};state.checks.push(f);state.checkFailures.push(f);}
  save();
 }
 const defaultsCode=await command('verify-defaults',['scripts/kiro-live-check.mjs','verify-defaults','--state',statePath]);
 state=JSON.parse(readFileSync(statePath,'utf8'));assert.equal(defaultsCode,0);state.defaultsUnchangedVerified=true;
 if(state.turns.length===4&&state.checks.length===4)state.completedAt=new Date().toISOString();
 save();
} catch(error) {
 summary.halted=true;summary.failureSha256=hash(String(error.stack??error));console.error(error);
} finally {
 summary.finishedAt=new Date().toISOString();summary.hashesUnchanged=JSON.stringify(hashes())===JSON.stringify(summary.codeHashes);
 summary.recordedRounds=state.turns.length;summary.checkedRounds=state.checks.length;summary.semanticFailureCount=state.checkFailures.length;
 summary.formatFailureCount=state.turns.filter(t=>t.format&&!t.format.complied).length;
 summary.controllerExitCode=summary.halted||!summary.hashesUnchanged?2:!state.completedAt||summary.semanticFailureCount||summary.formatFailureCount?1:0;
 save();console.log(JSON.stringify(summary,null,2));process.exitCode=summary.controllerExitCode;
}
