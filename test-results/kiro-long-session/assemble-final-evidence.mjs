// Local-only, fail-closed final export. Frozen attempt states are read-only.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildRecoveryEvidence, recoveryModels } from '../../app/scripts/kiro-live-evidence.mjs';
import { assertControlledTools } from '../../app/scripts/kiro-live-plan.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=relative=>readFileSync(new URL(relative,import.meta.url));
const checkedGate=(relative)=>{
 const bytes=read(relative),gate=JSON.parse(bytes);
 assert.ok(gate.allOwnedTasksQuiescent&&gate.defaultsUnchanged&&gate.hashChecks.length===6&&gate.hashChecks.every(x=>x.unchanged&&/^[a-f0-9]{64}$/.test(x.sha256)));
 assert.equal(gate.tasks.length,8);
 assert.ok(gate.tasks.every(t=>['completed','failed','cancelled'].includes(t.taskStatus)&&['completed','failed','cancelled'].includes(t.runStatus)&&t.queueLength===0&&
  Object.entries(t.persistentInputStates).every(([state,count])=>state==='delivered'||count===0)&&Number.isSafeInteger(t.persistentInputStates.delivered)&&
  (t.reloadStatus===null||['completed','failed','cancelled'].includes(t.reloadStatus))));
 return {gate,sha256:hash(bytes)};
};
const processExited=relative=>{const p=JSON.parse(read(relative));assert.equal(p.ownedRunnerProcessCount,0);assert.equal(p.ownerExitedAfterFinishedSummary,true);};
const summaryBytes=read('./recovery-continuation-v3/summary.json'),summary=JSON.parse(summaryBytes);
assert.ok(summary.finishedAt&&Number.isInteger(summary.controllerExitCode)&&summary.hashesUnchanged&&summary.allPlannedModelsVisited);
const before=checkedGate('./recovery-continuation-v3/quiescence-after-final.json');
processExited('./recovery-continuation-v3/process-quiescence.json');
const sourceDigests=[],states=Object.fromEntries(recoveryModels.map(model=>{
 const attempt=['minimax-m2.1','claude-haiku-4.5'].includes(model)?'recovery':'recovery-continuation-v3',bytes=read('./'+attempt+'/'+model+'/state.json');
 sourceDigests.push({model,receiptTag:attempt==='recovery'?'recovery-v2':'recovery-v3',stateSha256:hash(bytes)});return [model,JSON.parse(bytes)];
}));
const evidence=buildRecoveryEvidence(states,{allowIncomplete:true});evidence.attemptSources=sourceDigests;
evidence.finalRuntimeChecks={checkedAt:before.gate.checkedAt,atEndOfControlledContinuation:true,allOwnedTasksQuiescent:true,defaultsUnchanged:true,
 originalSixFrozenHashesVerifiedBeforePostRunChanges:true,ownedRunnerProcessesExited:true,sourceSha256:before.sha256};
assert.equal(evidence.matrixRoundCount,137);assert.equal(evidence.complete,false);
const totals=field=>evidence.models.reduce((sum,m)=>sum+m[field],0);
assert.equal(totals('protocolCompletedRoundCount'),136);assert.equal(totals('checkedRoundCount'),136);
assert.equal(totals('semanticFailureCount'),21);assert.equal(totals('formatCheckedRoundCount'),136);assert.equal(totals('formatFailureCount'),97);
const tailSummaryBytes=read('./sonnet-post429-v4/summary.json'),tailSummary=JSON.parse(tailSummaryBytes),tailStateBytes=read('./sonnet-post429-v4/state.json'),tail=JSON.parse(tailStateBytes);
assert.ok(tailSummary.finishedAt&&tailSummary.hashesUnchanged&&tailSummary.stoppedOnProtocolFailure);assert.equal(tailSummary.recordedRounds,1);
assert.equal(tailSummary.rounds.length,1);assert.equal(tail.turns.length,1);assert.equal(tail.checks.length,0);
const latest=checkedGate('./sonnet-post429-v4/quiescence-after-final.json');processExited('./sonnet-post429-v4/process-quiescence.json');
const turn=tail.turns[0],prior=states['claude-sonnet-4.5'].turns.at(-1),run=turn.run;
assert.equal(prior.label,'long-17-shell-recovery');assert.equal(run.status,'failed');assert.match(run.error,/HTTP\s*429/);
assert.equal(turn.inputCorrelated,true);assert.equal(turn.calls.length,0);assert.equal(turn.results.length,0);
assert.equal(turn.receipt.taskId,tail.taskId);assert.equal(turn.messageIds.filter(m=>m.role==='user'&&m.inputIds?.includes(turn.receipt.inputId)&&m.inputIds.length===1&&m.runId===run.id).length,1);
assert.equal(tailSummary.priorFailedRunId,prior.run.id);assert.equal(tailSummary.priorSourceSha256,sourceDigests.find(x=>x.model==='claude-sonnet-4.5').stateSha256);
assert.notEqual(turn.prompt,prior.prompt);assert.equal(prior.calls.length,2);assert.equal(prior.results.length,2);
assertControlledTools(prior.label,prior,{root:'F:/Axiom/axiom2/test-results/kiro-long-session/workspace',modelId:'claude-sonnet-4.5',
 receiptPath:'F:/Axiom/axiom2/test-results/kiro-long-session/workspace/matrix/claude-sonnet-4.5/receipt-recovery-v3.json',cwd:'F:/Axiom/axiom2'});
const cooldown=Date.parse(tailSummary.startedAt)-Date.parse(summary.finishedAt);assert.ok(cooldown>=300000);
assert.equal(run.retry.attempt,3);assert.equal(run.retry.maxAttempts,3);assert.equal(run.retry.state,'exhausted');
assert.equal(latest.gate.tasks.find(t=>t.taskRef===tail.taskRef).runId,run.id);
const initial=JSON.parse(read('../../docs/evidence/kiro-long-session/initial-attempt.json'));
const supplement=JSON.parse(read('../../docs/evidence/kiro-long-session/initial-minimax-m2.1-turn08-supplement.json'));
const allRunIds=[...initial.models.flatMap(m=>[...m.rounds,...m.supplementalTurns].map(r=>r.runId)),...evidence.models.flatMap(m=>[...m.rounds,...m.supplementalTurns].map(r=>r.runId)),supplement.runId,run.id];
assert.equal(new Set(allRunIds).size,allRunIds.length,'Distinct original/recovery/supplement/followup runs must not be merged');
const audit=JSON.parse(read('../../docs/evidence/kiro-long-session/assertion-audit.json'));
assert.equal(audit.entries.length,21);for(const entry of audit.entries)assert.equal(evidence.models.find(m=>m.model===entry.model).rounds.find(r=>r.runId===entry.runId).semanticCheck.passed,false);
const safeTask=t=>({taskRef:t.taskRef,taskStatus:t.taskStatus,runId:t.runId,runStatus:t.runStatus,selection:{provider:t.selection.provider,id:t.selection.id,thinking:t.selection.thinking},
 queueLength:t.queueLength,deliveredInputCount:t.persistentInputStates.delivered,persistentInputsAllDelivered:true,reloadStatus:t.reloadStatus});
const safeHashes=gate=>gate.hashChecks.map(x=>({path:x.path,sha256:x.sha256,unchanged:true}));
const runtime={schemaVersion:1,phase:'terminal-runtime-checks',checkedAt:latest.gate.checkedAt,allOwnedTasksQuiescent:true,defaultsUnchanged:true,ownedRunnerProcessesExited:true,
 originalFrozenHashes:safeHashes(before.gate),post429FrozenHashes:safeHashes(latest.gate),tasks:latest.gate.tasks.map(safeTask),
 snapshots:[{attempt:'controlled-continuation-v3',checkedAt:before.gate.checkedAt,sourceSha256:before.sha256},
 {attempt:'sonnet-post429-v4',checkedAt:latest.gate.checkedAt,sourceSha256:latest.sha256}],
 limitation:'These are historical terminal snapshots, not a claim that subsequently edited published harness files were live-matrix tested.'};
const oldBytes=read('./recovery/summary.json'),old=JSON.parse(oldBytes);
const attempts={schemaVersion:1,phase:'serial-recovery-attempts',
 policy:{promptPaceMs:30000,betweenModelMs:90000,oneControlledPassPerModel:true,noPromptReplay:true,noModelConcurrency:true},
 firstSerialAttempt:{startedAt:old.startedAt,finishedAt:old.finishedAt??null,complete:false,halted:true,completedModels:['minimax-m2.1','claude-haiku-4.5'],
 preparationFailure:{model:'minimax-m2.5',category:'reload-lock-not-yet-released',recordedModelRounds:0,promptsSent:0},ownerExitWasNotAcceptance:true,summarySha256:hash(oldBytes)},
 continuation:{startedAt:summary.startedAt,finishedAt:summary.finishedAt,controllerExitCode:summary.controllerExitCode,halted:!!summary.halted,
 models:summary.models.map(m=>({model:m.model,exitCode:m.exitCode,recordedRounds:m.recordedTurns??0,semanticFailureCount:m.semanticFailureCount??null,formatFailureCount:m.formatFailureCount??null,stoppedByHttp429:!!m.stoppedByHttp429})),
 summarySha256:hash(summaryBytes)},
 exitCodePolicy:'Controller/driver/curator success is not equivalent to protocol, semantic and whole-turn-format acceptance.'};
const post429={schemaVersion:1,phase:'bounded-post429-followup',model:'claude-sonnet-4.5',taskRef:tail.taskRef,startedAt:tailSummary.startedAt,finishedAt:tailSummary.finishedAt,
 priorFailedRunId:prior.run.id,originalSourceStateSha256:tailSummary.priorSourceSha256,followupStateSha256:hash(tailStateBytes),
 policy:{maximumNewInputs:4,actualNewInputs:1,unsentPlannedInputs:3,minimumCooldownMs:300000,actualCooldownMs:cooldown,noPriorInputReplay:true,noPriorToolReplay:true,stopOnAnyProtocolFailure:true},
 priorFailedRound:{label:prior.label,toolCalls:2,toolResults:2,existingToolEvidenceIndependentlyRechecked:true},
 rounds:[{label:turn.label,runId:run.id,status:run.status,selection:{provider:run.selection.provider,id:run.selection.id,thinking:run.selection.thinking},
 protocolError:{category:'upstream-rate-or-quota-429',errorSha256:hash(run.error)},promptCorrelation:{inputIdSha256:hash(turn.receipt.inputId),inputIdentityMatchedInEvidence:true,fullUserTextVerifiedByDriver:true},
 actualToolCalls:0,actualToolResults:0,checked:false,axiomInternalRetry:{attempt:run.retry.attempt,maxAttempts:run.retry.maxAttempts,state:'exhausted'}}],
 sourceHashes:tailSummary.codeHashes.map(x=>({path:x.path,sha256:x.sha256})),controllerExitCode:tailSummary.controllerExitCode,
 terminalChecks:{checkedAt:latest.gate.checkedAt,allOwnedTasksQuiescent:true,defaultsUnchanged:true,ownedRunnerProcessesExited:true,sourceSha256:latest.sha256},
 countingPolicy:'Separate from the 137 controlled recovery rounds. One new durable input is not one HTTP attempt; AXIOM recorded bounded internal retries. No further autonomous model inputs planned.',
 sources:{summarySha256:hash(tailSummaryBytes)}};
const outputs=[['controlled-recovery.json',evidence],['runtime-checks.json',runtime],['serial-attempts.json',attempts],['sonnet-post429.json',post429]];
for(const [name]of outputs)assert.ok(!existsSync(new URL('../../docs/evidence/kiro-long-session/'+name,import.meta.url)),'Never overwrite existing evidence: '+name);
for(const [name,data]of outputs)writeFileSync(new URL('../../docs/evidence/kiro-long-session/'+name,import.meta.url),JSON.stringify(data,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({exported:true,complete:evidence.complete,rounds:evidence.matrixRoundCount,protocolCompleted:totals('protocolCompletedRoundCount'),
 checked:totals('checkedRoundCount'),strictSemanticFailures:totals('semanticFailureCount'),formatChecked:totals('formatCheckedRoundCount'),formatFailures:totals('formatFailureCount'),
 models:evidence.models.map(m=>({model:m.model,rounds:m.matrixRoundCount,protocolCompleted:m.protocolCompletedRoundCount,checked:m.checkedRoundCount,semanticFailures:m.semanticFailureCount,formatFailures:m.formatFailureCount}))},null,2));
