// Final local verification manifest. All inputs are read-only; export is wx.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
const root=resolve(new URL('../..',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
const delivery='F:/Axiom/axiom-kiro-long-session-fb7031ed';
const result=resolve(root,'test-results/kiro-long-session');
const bytes=path=>readFileSync(path),hash=b=>createHash('sha256').update(b).digest('hex');
const read=name=>bytes(join(result,name)).toString('utf8').replace(/^\uFEFF/,'');
const json=name=>JSON.parse(read(name));
const number=(name,expected)=>{const v=Number(read(name).trim());assert.equal(v,expected,name);return v;};
const counts=name=>{const s=read(name),n=field=>{const m=s.match(new RegExp('(?:#|\u2139)\\s+'+field+'\\s+(\\d+)'));assert.ok(m,'Missing '+field+' in '+name);return Number(m[1]);};
 return {total:n('tests'),passed:n('pass'),failed:n('fail'),skipped:n('skipped')};};
const git=(...args)=>execFileSync('git',['-C',delivery,...args],{encoding:'utf8'}).trim();
const integrationBase=git('rev-parse','HEAD');assert.equal(integrationBase,git('rev-parse','origin/master'),'Integrate latest upstream before export');
const baseline=counts('delivery-final-kiro-tests.log');assert.deepEqual(baseline,{total:146,passed:146,failed:0,skipped:0});number('delivery-final-kiro-tests.exit-code.txt',0);
const compatibility=counts('delivery-final-compat-corrected.log');assert.deepEqual(compatibility,{total:41,passed:35,failed:0,skipped:6});number('delivery-final-compat-corrected.exit-code.txt',0);
const hardened=json('delivery-hardened-exit-codes.json');assert.equal(hardened.tests.exitCode,0);assert.equal(hardened.types.exitCode,2);
const native=json('delivery-native-hardened-exit-codes.json');assert.equal(native.tests.exitCode,0);assert.equal(native.types.exitCode,0);assert.equal(native.syntax.exitCode,0);
assert.deepEqual(counts('delivery-native-hardened-tests.log'),{total:26,passed:26,failed:0,skipped:0});
const hydration=json('delivery-hydration-exit-codes.json');assert.equal(hydration.tests.exitCode,0);assert.ok(hydration.syntax.length===5&&hydration.syntax.every(x=>x.exitCode===0));
assert.deepEqual(counts('delivery-hydration-tests.log'),{total:59,passed:59,failed:0,skipped:0});number('delivery-hydration-build.exit-code.txt',0);
const prompt=json('delivery-prompt-final-exit-codes.json');
assert.deepEqual(prompt,{tests:0,syntax:0,types:0});
assert.deepEqual(counts('delivery-prompt-final-tests.log'),{total:51,passed:51,failed:0,skipped:0});
assert.deepEqual(json('delivery-unit-fixture-final-exit-codes.json'),{tests:0,types:0});
assert.deepEqual(counts('delivery-unit-fixture-final-tests.log'),{total:51,passed:51,failed:0,skipped:0});
number('delivery-review-hardening-tests.exit-code.txt',1);assert.deepEqual(counts('delivery-review-hardening-tests.log'),{total:84,passed:83,failed:1,skipped:0});
const firstReview=json('delivery-review-hardening-tests.json');assert.equal(firstReview.exitCode,1);
const preCorrectionReview=json('delivery-review-hardening-types.json');assert.equal(preCorrectionReview.types.exitCode,0);assert.equal(preCorrectionReview.syntax.length,3);assert.ok(preCorrectionReview.syntax.every(s=>s.exitCode===0));
number('delivery-review-hardening-v2-tests.exit-code.txt',0);assert.deepEqual(counts('delivery-review-hardening-v2-tests.log'),{total:63,passed:63,failed:0,skipped:0});
const finalReviewTests=json('delivery-review-hardening-v2-tests.json');assert.equal(finalReviewTests.exit_code,0);
const finalReview=json('delivery-review-hardening-v2-types.json');assert.equal(finalReview.types.exitCode,0);assert.equal(finalReview.syntax.length,1);assert.equal(finalReview.syntax[0].exitCode,0);
number('delivery-eof-tests.exit-code.txt',0);assert.deepEqual(counts('delivery-eof-tests.log'),{total:81,passed:81,failed:0,skipped:0});
const eofTypes=json('delivery-eof-types.json');assert.equal(eofTypes.exitCode,0);
number('delivery-upstream-739-tests.exit-code.txt',0);assert.deepEqual(counts('delivery-upstream-739-tests.log'),{total:14,passed:14,failed:0,skipped:0});
for(const name of ['final-evidence-assembly.exit-code.txt','assertion-classification-audit.exit-code.txt','qwen-turn10-full-input-observation.exit-code.txt','readme-merge-recipe.exit-code.txt','reproduction-checks.exit-code.txt'])number(name,0);
const baseFiles=['app/src/server/providers/kiro-chat-protocol.ts','app/src/server/providers/kiro-chat.ts','app/tests/kiro-chat.test.ts','app/tests/kiro-thinking.test.ts','docs/kiro-thinking.md',
 ...['check','plan','evidence','lifecycle','native-proof'].map(n=>'app/scripts/kiro-live-'+n+'.mjs'),
 ...['kiro-interrupted-history','kiro-live-check','kiro-live-evidence','kiro-live-native-proof','kiro-live-plan','kiro-live-safety'].map(n=>'app/tests/'+n+'.test.ts')];
const publicRoot=resolve(root,'docs/evidence/kiro-long-session');
const publicFiles=['README.md','initial-attempt.json','initial-minimax-m2.1-turn08-supplement.json','lifecycle.json','rea.json','qwen-tool-input-supplement.json','assertion-audit.json','controlled-recovery.json','runtime-checks.json','serial-attempts.json','sonnet-post429.json','verification.json','verification-v2.json',
 ...['inventory.csv','ledger.json','visual-a.png','visual-b.png'].map(n=>'fixtures/'+n)];
const sourceFiles=[...baseFiles,...publicFiles.map(n=>'docs/evidence/kiro-long-session/'+n)];
assert.equal(new Set(sourceFiles).size,sourceFiles.length);
const upstreamPreservedExceptions=['app/src/server/providers/kiro-chat.ts','app/tests/kiro-chat.test.ts','docs/kiro-thinking.md'];
for(const path of baseFiles.filter(p=>!upstreamPreservedExceptions.includes(p)))assert.equal(hash(bytes(resolve(root,path))),hash(bytes(resolve(delivery,path))),'Source parity: '+path);
for(const path of publicFiles)assert.equal(hash(bytes(resolve(publicRoot,path))),hash(bytes(resolve(delivery,'docs/evidence/kiro-long-session',path))),'Evidence parity: '+path);
const privateIds=new Set();
const collect=value=>{if(!value||typeof value!=='object')return;
 for(const [k,v]of Object.entries(value)){if(['workspaceId','parentSessionId','sessionId','taskId','nativeSessionId','basename'].includes(k)&&typeof v==='string'&&v.length>7)privateIds.add(v);if(v&&typeof v==='object')collect(v);}};
for(const model of ['auto','claude-sonnet-4.5','claude-haiku-4.5','deepseek-3.2','minimax-m2.5','minimax-m2.1','glm-5','qwen3-coder-next'])collect(json('matrix/'+model+'/state.json'));
for(const model of ['minimax-m2.1','claude-haiku-4.5'])collect(json('recovery/'+model+'/state.json'));
for(const model of ['minimax-m2.5','glm-5','qwen3-coder-next','deepseek-3.2','claude-sonnet-4.5'])collect(json('recovery-continuation-v3/'+model+'/state.json'));
collect(json('state.json'));collect(json('sonnet-post429-v4/state.json'));
const forbiddenKeys=new Set(['workspaceId','parentSessionId','sessionId','taskId','inputId','prompt','answer','thinkingText','signature','toolArguments','toolResults','nativeSessionId','transcriptBasename']);
const scanObject=(o,path='',file='')=>{if(!o||typeof o!=='object')return;for(const [k,v]of Object.entries(o)){
 const benignMetadata=(file==='lifecycle.json'&&((path==='.cases.0'&&k==='toolResults'&&Array.isArray(v)&&v.length===0)||(path==='.contentPolicy'&&k==='toolArguments'&&v==='hashes and constrained observation booleans only')||(path==='.contentPolicy'&&k==='thinking'&&v==='counts only')))||(file==='sonnet-post429.json'&&path==='.priorFailedRound'&&k==='toolResults'&&Number.isSafeInteger(v)&&v>=0);
 assert.ok(benignMetadata||!forbiddenKeys.has(k),'Raw body/private key at '+file+path+'.'+k);
 if(k==='thinking'&&!benignMetadata)assert.ok(['off','minimal','low','medium','high'].includes(v));if(k==='runId')assert.match(v,/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);if(k==='taskRef')assert.match(v,/^t\d+$/);if(v&&typeof v==='object')scanObject(v,path+'.'+k,file);}};
for(const path of sourceFiles.filter(p=>!p.endsWith('.png'))){const s=bytes(resolve(delivery,path)).toString('utf8');for(const id of privateIds)assert.ok(!s.includes(id),'Private identity leaked: '+path);
 assert.ok(!/C:[\\/]+Users[\\/]+dane|F:[\\/]+Axiom[\\/]+axiom2[\\/]+test-results/i.test(s),'Private machine path: '+path);}
for(const name of publicFiles.filter(n=>n.endsWith('.json')))scanObject(JSON.parse(bytes(resolve(publicRoot,name)).toString('utf8').replace(/^\uFEFF/,'')),'',name);
const recovery=JSON.parse(bytes(resolve(publicRoot,'controlled-recovery.json'))),audit=JSON.parse(bytes(resolve(publicRoot,'assertion-audit.json')));
assert.equal(recovery.complete,false);assert.equal(recovery.matrixRoundCount,137);assert.equal(audit.entries.length,21);
const evidenceRunIds=recovery.models.flatMap(m=>m.rounds.map(r=>r.runId));assert.equal(new Set(evidenceRunIds).size,137);
const log=(name)=>hash(bytes(join(result,name)));
const check=(id,command,data,logName,note)=>({id,command,...data,logSha256:log(logName),...(note?{scopeNote:note}:{})});
const checks=[
 check('historical-integrated-kiro-baseline','node --import tsx --test --test-concurrency=1 tests/kiro-auth.test.ts tests/kiro-callback.test.ts tests/kiro-catalog.test.ts tests/kiro-chat.test.ts tests/kiro-images.test.ts tests/kiro-interrupted-history.test.ts tests/kiro-live-evidence.test.ts tests/kiro-live-plan.test.ts tests/kiro-pooling.test.ts tests/kiro-runtime.test.ts tests/kiro-thinking.test.ts',{exitCode:0,...baseline},'delivery-final-kiro-tests.log','Historical 11-file baseline before later harness/test hardening; not a fresh complete-suite run of the final scripts.'),
 check('compatibility','node --import tsx --test --test-concurrency=1 tests/model-default.test.ts tests/models.test.ts tests/model-runtime.test.ts tests/process-owner-record.test.ts tests/theme.test.ts',{exitCode:0,...compatibility},'delivery-final-compat-corrected.log','Six Linux-only cases skipped on Windows.'),
 check('curator-and-interruption-hardening',hardened.tests.command,{exitCode:0,...counts('delivery-hardened-tests.log')},'delivery-hardened-tests.log','The initial associated typecheck failed; the corrected interruption test is covered below.'),
 check('native-proof-and-corrected-interruption',native.tests.command,{exitCode:0,...counts('delivery-native-hardened-tests.log')},'delivery-native-hardened-tests.log'),
 check('full-input-cli-configuration-and-no-overwrite',hydration.tests.command,{exitCode:0,...counts('delivery-hydration-tests.log')},'delivery-hydration-tests.log','51 plan + 6 identity/path configuration + 2 CLI safety cases. Followed by one prompt-only edit and its affected check below.'),
 check('final-prompt-no-supplied-repair-answer','node --import tsx --test tests/kiro-live-plan.test.ts',{exitCode:0,...counts('delivery-prompt-final-tests.log')},'delivery-prompt-final-tests.log','Final prompt removes the reduce initial-value hint; no final real-model matrix rerun.'),
 check('final-synthetic-unit-paths','node --import tsx --test tests/kiro-live-plan.test.ts',{exitCode:0,...counts('delivery-unit-fixture-final-tests.log')},'delivery-unit-fixture-final-tests.log','Only a test fixture path changed from a real repository path to a synthetic Windows path; final production MJS unchanged.'),
 check('pre-review-types','npx tsc --noEmit',{exitCode:0},'delivery-unit-fixture-final-types.log'),
 check('first-review-hardening-attempt',firstReview.command,{exitCode:1,...counts('delivery-review-hardening-tests.log')},'delivery-review-hardening-tests.log','Initial four-file run failed: positive AST fixture used the wrong record shape; the negative AST fixture also caught an unrelated TypeError. Corrected tests and adversarial AST/sentinel cases are covered below. The 3 safety and 18 curator cases passed here and their source/dependencies are unchanged.'),
 check('final-review-plan-and-cli',finalReviewTests.command,{exitCode:0,...counts('delivery-review-hardening-v2-tests.log')},'delivery-review-hardening-v2-tests.log','Current affected plan and importing driver scope after correcting fixture contracts, duplicate callback/TS-only AST syntax and forged writer sentinels; no generated source execution or real-model request. Unchanged safety/curator cases are not rerun.'),
 check('final-eof-byte-scope','node --import tsx --test --test-concurrency=1 tests/kiro-live-plan.test.ts tests/kiro-live-check.test.ts tests/kiro-live-evidence.test.ts',{exitCode:0,...counts('delivery-eof-tests.log')},'delivery-eof-tests.log','Only one extra final blank line was removed from each of these three tests after cached diff checking. No production script changed. This overlapping scope is not added to the earlier 63 or 84 tests.'),
 check('final-types',eofTypes.command,{exitCode:0},'delivery-eof-types.log'),
 check('complete-delivery-build','npm run build',{exitCode:0},'delivery-hydration-build.log','tsc --noEmit && vite build && tsc -p tsconfig.server.json; only chunk-size warning. Subsequent edits affect opt-in scripts and tests only, including CLI/static-validation hardening, separately tested/type/syntax checked; Vite/server production inputs unchanged.'),
 check('upstream-739-affected-tests','node --import tsx --test tests/memory-runner.test.ts tests/compression.test.ts tests/model-switch.test.ts tests/native-source-proof.test.ts',{exitCode:0,...counts('delivery-upstream-739-tests.log')},'delivery-upstream-739-tests.log'),
 check('historical-evidence-assembly','node assemble-final-evidence.mjs',{exitCode:0,controlledRecordedRounds:137,controlledProtocolCompleted:136,strictChecksPassed:115,strictChecksChecked:136,wholeTurnFormatPassed:39,wholeTurnFormatChecked:136},'final-evidence-assembly.log','Local-only; command is an uncommitted local export script, not an additional model test.'),
 check('posthoc-21-failure-classifications','node audit-assertion-classifications.mjs',{exitCode:0,classifiedOriginalFailures:21,newModelRequests:0},'assertion-classification-audit.log','Original scores and raw states unchanged.'),
 check('posthoc-qwen-input-observation','node observe-qwen-turn10.mjs',{exitCode:0,toolCallsObserved:6,completeDetailsRead:2,newModelRequests:0},'qwen-turn10-full-input-observation.log','Read-only AXIOM WS history/detail operations; not a new scored run.'),
 check('documented-cross-root-recipe','README ASCII here-string | node --input-type=module - ROOT_A ROOT_B NEW_OUTPUT',{exitCode:0,newModelRequests:0},'readme-merge-recipe.log'),
 check('recipe-output-and-synthetic-fixtures','node check-reproduction-fixtures.mjs',{exitCode:0,canonicalRecoveryModelsEqual:true,publishedFixturesVerified:4,newModelRequests:0},'reproduction-checks.log')
];
for(const c of checks)c.commandEvidence=['historical-integrated-kiro-baseline','compatibility','upstream-739-affected-tests'].includes(c.id)?'Reproducible file-scope command; exact historical flags were not retained in the numeric exit-code record.':'Recorded invocation or explicitly identified README recipe.';
const manifest={schemaVersion:1,phase:'final-offline-verification',generatedAt:new Date().toISOString(),platform:process.platform,node:process.version,integrationBaseCommit:integrationBase,
 supersedes:'verification-v2.json',previousSnapshotSha256:hash(bytes(resolve(publicRoot,'verification-v2.json'))),
 realModelMatrixComplete:false,remainingExternalBlocker:'Sonnet round 17 and one bounded followup failed HTTP 429; no further Kiro inputs were sent.',
 countPolicy:'Check groups overlap and must not be summed. Unit/mock/build/syntax evidence does not replace real AXIOM model runs. Local raw logs are retained, not published.',
 preservedFailureHistory:[{id:'wrong-test-filename-preflight',status:'not-run',recordSha256:log('delivery-final-compat.exit-code.txt'),resolvedBy:'compatibility'},
 {id:'first-hardening-types',exitCode:2,logSha256:log('delivery-hardened-types.log'),resolvedBy:['native-proof-and-corrected-interruption','complete-delivery-build','final-types']},
 {id:'first-cached-diff-whitespace',exitCode:2,logSha256:log('release-cached-check-v2.log'),scope:'Three new tests had an extra blank line at EOF; only those blank lines were removed.',resolvedBy:'final-eof-byte-scope'},
 {id:'initial-review-ast-fixture-contract',exitCode:1,logSha256:log('delivery-review-hardening-tests.log'),sourceSha256:{plan:log('plan-before-review-v4-corrections.mjs'),planTest:log('plan-test-before-review-v4-corrections.ts')},resolvedBy:'final-review-plan-and-cli',scope:'Offline harness and test correction; original model scores unchanged.'},
 ...[['verification-export.log','upstream-doc-parity-exception'],['verification-export-v2.log','synthetic-unit-fixture-path'],['verification-export-v3.log','overbroad-json-key-guard'],['verification-export-v4.log','utf8-bom-in-synthetic-json-fixture']].map(([name,category])=>({id:category,exitCode:1,logSha256:log(name),scope:'Local export preflight, not a model/protocol test.',resolvedBy:'current-manifest-export'}))],
 checks,syntaxChecks:hydration.syntax.map(x=>({command:x.command,exitCode:x.exitCode})),
 preCorrectionSyntaxChecks:preCorrectionReview.syntax.map(s=>({command:s.command,exitCode:s.exitCode})),
 finalReviewSyntaxChecks:finalReview.syntax.map(s=>({command:s.command,exitCode:s.exitCode})),
 finalPromptSyntax:{command:'node --check scripts/kiro-live-plan.mjs',exitCode:0,logSha256:log('delivery-prompt-final-syntax.log')},
 reproduction:json('reproduction-checks.json'),
 privacyChecks:{actualPrivateIdentityValuesScanned:privateIds.size,noActualPrivateIdentityValueOrMachinePathInPublication:true,noRawBodyOrPrivateIdentityKeysInPublicJson:true,actualPublicRunIdAndTaskRefFormatsVerified:true,
 limitation:'Trusted driver-state allowlist, not a general anonymizer. Public run IDs/task refs remain linkable; synthetic input fixtures intentionally published.'},
 sourceSnapshot:{hashMeaning:'Working-file byte snapshot, not dist/worker-loaded proof. Repository-content hashes normalize CRLF for text; historical executing source hashes remain in each evidence attempt.',
 upstreamPreservedExceptions:upstreamPreservedExceptions.map(path=>({path,reason:path==='docs/kiro-thinking.md'?'Upstream live-test provenance paragraph retained; main tree still has its older offline-only paragraph. Content difference independently inspected.':'Upstream timeout/keepAlive implementation and associated test retained in delivery.'})),
 files:sourceFiles.map(path=>{const data=bytes(resolve(delivery,path));return {path,sha256:hash(data),repositoryContentSha256:hash(path.endsWith('.png')?data:Buffer.from(data.toString('utf8').replace(/\r\n/g,'\n')))};})}};
const serialized=JSON.stringify(manifest,null,2)+'\n';scanObject(manifest,'','verification-v3.json');
for(const id of privateIds)assert.ok(!serialized.includes(id),'Private identity in manifest');assert.ok(!/C:[\\/]+Users[\\/]+dane|F:[\\/]+Axiom[\\/]+axiom2[\\/]+test-results/i.test(serialized),'Private machine path in manifest');
writeFileSync(resolve(publicRoot,'verification-v3.json'),serialized,{flag:'wx'});
console.log(JSON.stringify({verificationExported:true,sourceFiles:sourceFiles.length,checks:checks.length,privateValuesScanned:privateIds.size,realModelMatrixComplete:false}));
