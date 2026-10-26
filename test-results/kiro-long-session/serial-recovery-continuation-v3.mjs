// Local, single-use continuation after a zero-prompt RELOAD_BUSY preparation failure.
// Every model request remains confined to registered AXIOM tasks via the WS driver.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
const app = 'F:/Axiom/axiom2/app';
const root = 'F:/Axiom/axiom2/test-results/kiro-long-session/recovery-continuation-v3';
const plan = [
  ['minimax-m2.5', 't4017', false],
  ['glm-5', 't4019', false],
  ['qwen3-coder-next', 't4020', false],
  ['deepseek-3.2', 't4016', false],
  ['claude-sonnet-4.5', 't4046', true],
];
const files = ['src/server/providers/kiro-chat-protocol.ts', 'src/server/providers/kiro-chat.ts', 'scripts/kiro-live-check.mjs', 'scripts/kiro-live-plan.mjs', 'dist/server/providers/kiro-chat-protocol.js', 'dist/server/providers/kiro-chat.js'];
const hashes = () => files.map(path => ({ path, sha256: createHash('sha256').update(readFileSync(app + '/' + path)).digest('hex') }));
assert.equal(existsSync(root), false, 'Single-use attempt: do not overwrite or resume any existing root');
mkdirSync(root);
const summary = { attempt:'recovery-continuation-v3', scope:'remaining-five-models-only', pid:process.pid, startedAt:new Date().toISOString(),
  priorAttempt:'recovery-v2', priorZeroPromptPreparationFailurePreserved:true, pacingMs:30000, betweenModelsMs:90000, maxPassesPerModel:1, codeHashes:hashes(), models:[] };
const save = () => writeFileSync(root + '/summary.json', JSON.stringify(summary,null,2)+'\n');
save();
try {
  for (const [model, task, vision] of plan) {
    assert.deepEqual(hashes(), summary.codeHashes, 'Frozen source or dist changed');
    const directory=root+'/'+model; mkdirSync(directory);
    const statePath=directory+'/state.json';
    assert.equal(existsSync(statePath), false);
    const args=['scripts/kiro-live-check.mjs','matrix-long','--model',model,'--task',task,'--state',statePath,
      '--controlled-prompts','--fresh-worker','--pace-ms','30000','--receipt-tag','recovery-v3',...(vision?['--vision']:[])];
    const fd=openSync(directory+'/run.log','wx');
    let child, code;
    try {
      child=spawn(process.execPath,args,{cwd:app,stdio:['ignore',fd,fd],windowsHide:true});
      const record={model,task,vision,pid:child.pid??null,startedAt:new Date().toISOString()};
      summary.models.push(record); save();
      writeFileSync(root+'/active-model.json',JSON.stringify(record,null,2)+'\n');
      code=await new Promise(resolve=>{child.once('error',()=>resolve(125));child.once('close',value=>resolve(value??125));});
      record.exitCode=code;record.endedAt=new Date().toISOString();
      writeFileSync(directory+'/exit-code.txt',String(code)+'\n',{flag:'wx'});
      let state;try{state=JSON.parse(readFileSync(statePath,'utf8'));}catch{}
      if(state){assert.equal(state.taskRef,task);assert.equal(state.harness?.receiptTag,'recovery-v3');}
      const last=state?.turns?.at(-1);
      record.recordedTurns=state?.turns?.length??0;
      record.completedAt=state?.completedAt??null;
      record.semanticFailureCount=state?.checkFailures?.length??null;
      record.formatFailureCount=state?.turns?.filter(t=>t.format&&!t.format.complied).length??null;
      record.stoppedByHttp429=last?.run?.status==='failed'&&/HTTP\s*429/.test(last.run.error??'');
      if(code!==0&&!record.stoppedByHttp429&&!state?.completedAt){summary.halted='Unexpected interruption: inspect the owned task before any new prompt';save();break;}
      save();
    } finally {closeSync(fd);}
    if(model!==plan.at(-1)[0])await delay(90000);
  }
} catch(error) {
  summary.halted='Local orchestration or frozen-code assertion failed';
  summary.localFailureSha256=createHash('sha256').update(String(error.stack??error)).digest('hex');
  console.error(error);
} finally {
  summary.finishedAt=new Date().toISOString();
  summary.hashesUnchanged=JSON.stringify(hashes())===JSON.stringify(summary.codeHashes);
  summary.allPlannedModelsVisited=summary.models.length===plan.length;
  summary.allProtocolsAndSemanticChecksPassed=!summary.halted&&summary.hashesUnchanged&&summary.allPlannedModelsVisited&&summary.models.every(m=>m.completedAt&&m.semanticFailureCount===0);
  summary.allStrictFormatsPassed=summary.allProtocolsAndSemanticChecksPassed&&summary.models.every(m=>m.formatFailureCount===0);
  summary.controllerExitCode=summary.halted||!summary.hashesUnchanged?2:summary.allStrictFormatsPassed?0:1;
  save();console.log(JSON.stringify(summary,null,2));process.exitCode=summary.controllerExitCode;
}
