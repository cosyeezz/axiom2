// Independent offline classification, never rewrites scores or invokes tools/models.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {semanticJson,assertControlledAnswer} from '../../app/scripts/kiro-live-plan.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex'), entries=[], sources=[];
const load=model=>{const attempt=['minimax-m2.1','claude-haiku-4.5'].includes(model)?'recovery':'recovery-continuation-v3';
 const file=new URL('./'+attempt+'/'+model+'/state.json',import.meta.url),bytes=readFileSync(file),state=JSON.parse(bytes);sources.push({model,stateSha256:hash(bytes)});return state;};
const all=Object.fromEntries(['minimax-m2.1','minimax-m2.5','glm-5','qwen3-coder-next','deepseek-3.2','claude-sonnet-4.5'].map(m=>[m,load(m)]));
const round=(model,n)=>{const s=all[model],t=s.turns.find(t=>t.label.startsWith('long-'+String(n).padStart(2,'0')+'-'));
 assert.equal(s.checks.find(c=>c.label===t.label).passed,false);return t;};
for(const [model,numbers] of [['glm-5',[6,7]],['qwen3-coder-next',[6,7,15,19]],['deepseek-3.2',[6,7]]]){
 for(const n of numbers){const t=round(model,n),o=semanticJson(t.answer);
  const objects=n===15||n===19?[o.archiveA,o.archiveB]:[o];
  for(const item of objects){assert.equal(typeof item.ARCHIVE_VALUE,'string');assert.match(item.ARCHIVE_VALUE,/^\d+$/);item.ARCHIVE_VALUE=Number(item.ARCHIVE_VALUE);}
  assertControlledAnswer(t.label,{...t,answer:JSON.stringify(o)},{vision:false});
  entries.push({model,label:t.label,runId:t.run.id,category:'numeric-string-prompt-validator-ambiguity',originalCheckPassed:false,
   observations:{allRequiredSemanticFieldsPassAfterOnlyNumericTypeNormalization:true,recordedFormatComplied:t.format.complied}});
 }}
{
 const model='minimax-m2.1',t=round(model,5),o=semanticJson(t.answer);assert.equal(typeof o.multiplication,'string');
 assert.equal(Number(o.multiplication.match(/\d+\s*$/)?.[0]),703);o.multiplication=703;assertControlledAnswer(t.label,{...t,answer:JSON.stringify(o)},{vision:false});
 entries.push({model,label:t.label,runId:t.run.id,category:'multiplication-string-prompt-validator-ambiguity',originalCheckPassed:false,
 observations:{correctTerminalProductValue:true,allRequiredSemanticFieldsPassAfterNumericRepresentationNormalization:true}});
}
{
 const model='minimax-m2.5',t=round(model,20),o=semanticJson(t.answer);
 assert.equal(o.marker,'MATRIX-K3');assert.equal(o.checkword,'白鹭');assert.ok([o.total,o.checksum,o.sum,o.result].includes(1555));assert.equal(t.format.complied,true);
 entries.push({model,label:t.label,runId:t.run.id,category:'bare-text-validator-rejects-correct-json-checksum',originalCheckPassed:false,
 observations:{correctMarkerCheckwordAndChecksum:true,recordedOneLineFormatComplied:true,originalPromptDidNotExplicitlyBanJson:true}});
}
{
 const model='claude-sonnet-4.5',t=round(model,1);
 assert.ok(t.answer.includes('MATRIX-K3')&&t.answer.includes('703')&&t.answer.includes('白鹭'));
 entries.push({model,label:t.label,runId:t.run.id,category:'whole-turn-seed-framing-contract',originalCheckPassed:false,
 observations:{allThreeSeedValuesPresent:true,recordedFormatComplied:t.format.complied,notIndependentMultiplicationEvidence:true}});
}
for(const [model,n,key,expected,actual] of [['minimax-m2.5',14,'difference',652,647],['qwen3-coder-next',14,'difference',652,683]]){
 const t=round(model,n),o=semanticJson(t.answer);assert.equal(o[key],actual);entries.push({model,label:t.label,runId:t.run.id,category:'incorrect-arithmetic-or-state-selection',
 originalCheckPassed:false,observations:{field:key,expected,actual,valuesDiffer:true}});
}
for(const [model,actual] of [['qwen3-coder-next',1866],['deepseek-3.2',1503]]){
 const t=round(model,20);assert.match(t.answer,new RegExp('\\b'+actual+'\\b'));
 entries.push({model,label:t.label,runId:t.run.id,category:'incorrect-checksum',originalCheckPassed:false,observations:{expected:1555,actual,valuesDiffer:true}});
}
for(const model of ['minimax-m2.1','minimax-m2.5'])for(const n of [10,17]){
 const t=round(model,n),reads=t.results.filter(r=>r.toolName.replace(/^functions\./,'')==='read'),last=reads.at(-1);assert.ok(last);
 const o=JSON.parse(last.text.trim());assert.notEqual(o.checkword,'白鹭');assert.ok(last.text.includes('\uFFFD'));
 entries.push({model,label:t.label,runId:t.run.id,category:'unicode-corrupted-in-observed-read-result',originalCheckPassed:false,
 observations:{observedReadContainsReplacementCharacter:true,readCheckwordCorrect:false,exactEncodingStageAndDiskBytesNotIndependentlyVerified:true}});
}
{
 const model='minimax-m2.5',t=round(model,13),o=semanticJson(t.answer);assert.equal(typeof o.code,'string');assert.ok(!o.code.includes('.reduce'));
 entries.push({model,label:t.label,runId:t.run.id,category:'incomplete-reduce-code-contract',originalCheckPassed:false,
 observations:{codeStringDoesNotContainReduceCall:true,generatedCodeExecuted:false}});
}
const q=JSON.parse(readFileSync(new URL('../../docs/evidence/kiro-long-session/qwen-tool-input-supplement.json',import.meta.url)));
assert.equal(q.checks.recoveryAwareRuleWithHydratedInputs.passed,true);
entries.push({model:q.model,label:q.label,runId:q.runId,category:'truncated-tool-input-observation-and-repair-order-validator',originalCheckPassed:false,
 observations:{fullInputSupplementHasSixCalls:true,twoProjectedInputsWereTruncated:true,recoveryAwarePosthocToolCheckPassed:true,originalStrictCheckUnchanged:true}});
assert.equal(entries.length,21);assert.equal(new Set(entries.map(x=>x.runId)).size,21);
for(const {model,stateSha256}of sources){const attempt=['minimax-m2.1','claude-haiku-4.5'].includes(model)?'recovery':'recovery-continuation-v3';
 assert.equal(hash(readFileSync(new URL('./'+attempt+'/'+model+'/state.json',import.meta.url))),stateSha256);}
const evidence={schemaVersion:1,phase:'posthoc-assertion-classification',generatedAt:new Date().toISOString(),originalStrictFailureCount:21,
 scoringPolicy:'Independent classification only. Original checks, state files and counts are unchanged. Normalization is a diagnostic, not a new scored pass.',
 contentPolicy:'No answer, prompt, thinking, tool argument/result bodies, credentials or private session metadata.',newModelRequests:0,sources,entries};
writeFileSync(new URL('../../docs/evidence/kiro-long-session/assertion-audit.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({classifiedOriginalFailures:entries.length,unchangedOriginalFailureCount:21,newModelRequests:0,categories:entries.reduce((o,e)=>(o[e.category]=(o[e.category]??0)+1,o),{})}));
