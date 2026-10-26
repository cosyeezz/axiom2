import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
const delivery='F:/Axiom/axiom-kiro-long-session-fb7031ed',main='F:/Axiom/axiom2',result=resolve(main,'test-results/kiro-long-session');
const mode=process.argv[2]||'prestage';assert.ok(['prestage','staged','commit'].includes(mode));
const hash=b=>createHash('sha256').update(b).digest('hex');
const data=p=>readFileSync(resolve(delivery,p));
const git=(...args)=>execFileSync('git',['-C',delivery,...args]);
const text=(...args)=>git(...args).toString('utf8').trim();
const lines=(...args)=>text(...args).split(/\r?\n/).filter(Boolean);
const sort=a=>[...a].sort();
const parse=b=>JSON.parse(b.toString('utf8').replace(/^\uFEFF/,''));
const base=['app/src/server/providers/kiro-chat-protocol.ts','app/src/server/providers/kiro-chat.ts','app/tests/kiro-chat.test.ts','app/tests/kiro-thinking.test.ts','docs/kiro-thinking.md',...['check','plan','evidence','lifecycle','native-proof'].map(n=>'app/scripts/kiro-live-'+n+'.mjs'),...['kiro-interrupted-history','kiro-live-check','kiro-live-evidence','kiro-live-native-proof','kiro-live-plan','kiro-live-safety'].map(n=>'app/tests/'+n+'.test.ts')];
const prefix='docs/evidence/kiro-long-session/';
const pub=['README.md','initial-attempt.json','initial-minimax-m2.1-turn08-supplement.json','lifecycle.json','rea.json','qwen-tool-input-supplement.json','assertion-audit.json','controlled-recovery.json','runtime-checks.json','serial-attempts.json','sonnet-post429.json','verification.json','verification-v2.json','verification-v3.json',...['inventory.csv','ledger.json','visual-a.png','visual-b.png'].map(n=>'fixtures/'+n)];
const expected=[...base,...pub.map(p=>prefix+p)];assert.equal(expected.length,34);assert.equal(new Set(expected).size,34);
const m=parse(data(prefix+'verification-v3.json'));assert.equal(m.realModelMatrixComplete,false);assert.equal(m.checks.length,19);assert.equal(m.supersedes,'verification-v2.json');assert.equal(hash(data(prefix+'verification-v2.json')),m.previousSnapshotSha256);
assert.deepEqual(sort(m.sourceSnapshot.files.map(f=>f.path)),sort(expected.filter(p=>p!==prefix+'verification-v3.json')));
for(const f of m.sourceSnapshot.files)assert.equal(hash(data(f.path)),f.sha256,'Snapshot working bytes '+f.path);
for(const p of pub)assert.equal(hash(data(prefix+p)),hash(readFileSync(resolve(main,prefix+p))),'Main/delivery evidence parity '+p);
const recovery=parse(data(prefix+'controlled-recovery.json'));assert.equal(recovery.matrixRoundCount,137);assert.equal(recovery.complete,false);
const rounds=recovery.models.flatMap(m=>m.rounds);assert.equal(rounds.length,137);assert.equal(rounds.filter(r=>r.status==='completed').length,136);assert.equal(new Set(rounds.map(r=>r.runId)).size,137);
const sum=key=>recovery.models.reduce((total,m)=>total+m[key],0);assert.equal(sum('checkedRoundCount'),136);assert.equal(sum('checkedRoundCount')-sum('semanticFailureCount'),115);assert.equal(sum('formatCheckedRoundCount'),136);assert.equal(sum('formatCheckedRoundCount')-sum('formatFailureCount'),39);
const audit=parse(data(prefix+'assertion-audit.json'));assert.equal(audit.entries.length,21);
const tail=parse(data(prefix+'sonnet-post429.json'));assert.equal(tail.policy.actualNewInputs,1);assert.equal(tail.rounds[0].status,'failed');assert.equal(tail.rounds[0].actualToolCalls,0);assert.equal(tail.rounds[0].actualToolResults,0);
let jsonFiles=0,links=0;for(const p of expected){if(p.endsWith('.json')){parse(data(p));jsonFiles++;}if(p.endsWith('.md'))for(const match of data(p).toString('utf8').matchAll(/\[[^\]]*\]\(([^)]+)\)/g)){const target=match[1].split('#')[0];if(!target||/^https?:\/\//i.test(target))continue;assert.ok(existsSync(resolve(delivery,dirname(p),decodeURIComponent(target))),'Missing Markdown target '+p+' -> '+target);links++;}}
for(const p of pub.filter(p=>p.endsWith('.png')))assert.equal(data(prefix+p).subarray(0,8).toString('hex'),'89504e470d0a1a0a');
const revision=text('rev-parse','HEAD'),parent=mode==='commit'?text('rev-parse','HEAD^'):revision;assert.equal(parent,m.integrationBaseCommit,'Integration base changed');
if(mode==='prestage'){
 const staged=lines('diff','--cached','--name-only');assert.ok(staged.every(p=>expected.includes(p)),'Only this publication may already be staged');
 const changed=[...new Set([...staged,...lines('diff','--name-only'),...lines('ls-files','--others','--exclude-standard')])];assert.deepEqual(sort(changed),sort(expected),'Only exact publication scope may be dirty');
}else{
 assert.equal(text('diff','--name-only'),'','No unstaged changes allowed');assert.equal(text('ls-files','--others','--exclude-standard'),'','No untracked publication extras allowed');
 const actual=mode==='staged'?lines('diff','--cached','--name-only'):lines('diff','HEAD^','HEAD','--name-only');assert.deepEqual(sort(actual),sort(expected),'Git scope');
 for(const f of m.sourceSnapshot.files)assert.equal(hash(git('show',(mode==='staged'?':':'HEAD:')+f.path)),f.repositoryContentSha256,'Git blob SHA256 '+f.path);
 assert.equal(hash(git('show',(mode==='staged'?':':'HEAD:')+prefix+'verification-v3.json')),hash(data(prefix+'verification-v3.json')),'Manifest staged bytes');
 if(mode==='commit')assert.equal(text('status','--porcelain'),'','Isolated delivery tree must be clean');
}
const report={mode,filesVerified:34,sourceSnapshotFilesVerified:33,evidenceParityFiles:pub.length,jsonFilesParsed:jsonFiles,markdownFileTargetsChecked:links,gitBlobHashesVerified:mode==='prestage'?0:34,revision,integrationBase:m.integrationBaseCommit,controlledRecordedRounds:137,controlledCompleted:136,strictCheckPassed:115,wholeTurnFormatPassed:39,realModelMatrixComplete:false};
writeFileSync(resolve(result,'release-tree-'+mode+'-v3.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
