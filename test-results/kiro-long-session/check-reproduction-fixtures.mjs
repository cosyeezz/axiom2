import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,copyFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
const read=p=>readFileSync(new URL(p,import.meta.url)),hash=b=>createHash('sha256').update(b).digest('hex');
const frozen=JSON.parse(read('../../docs/evidence/kiro-long-session/controlled-recovery.json')),merged=JSON.parse(read('./readme-merge-recipe-export.json'));
assert.deepEqual(merged.models,frozen.models);assert.equal(merged.matrixRoundCount,137);assert.equal(merged.complete,false);
const names=['inventory.csv','ledger.json','visual-a.png','visual-b.png'],temp=mkdtempSync(join(tmpdir(),'axiom-published-fixtures-'));
try{for(const name of names)copyFileSync(new URL('../../docs/evidence/kiro-long-session/fixtures/'+name,import.meta.url),join(temp,name));
 const hashes=Object.fromEntries(names.map(name=>[name,hash(readFileSync(join(temp,name)))]));
 for(const model of frozen.models)for(const f of model.harness.fixtures)assert.equal(hashes[f.name],f.sha256);
 assert.equal(readFileSync(join(temp,'inventory.csv'),'utf8').replace(/^\uFEFF/,'').replace(/\r/g,'').trim(),'color,initial,delta\nred,17,-3\nblue,23,5\ngreen,11,-2');
 const ledger=JSON.parse(readFileSync(join(temp,'ledger.json'),'utf8').replace(/^\uFEFF/,''));for(const [k,v]of Object.entries({red:14,blue:28,green:9,total:51}))assert.equal(ledger[k],v);
 for(const name of ['visual-a.png','visual-b.png'])assert.equal(readFileSync(join(temp,name)).subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 writeFileSync(new URL('./reproduction-checks.json',import.meta.url),JSON.stringify({mergeRecipeExitCode:0,exportedModelsEqualCanonicalRecovery:true,recordedRounds:137,complete:false,
 publishedFixtureCount:4,allFixtureHashesMatchHistoricalControlledRuns:true,syntheticCsvAndLedgerValuesVerified:true,syntheticPngSignaturesAndVisualContentsVerified:true,
 fixtureHashes:hashes,newModelRequests:0},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({offlineRecipePassed:true,rounds:137,complete:false,publishedFixtures:4,allFixtureHashesMatchHistoricalControlledRuns:true,newModelRequests:0}));
}finally{rmSync(temp,{recursive:true,force:true});}
