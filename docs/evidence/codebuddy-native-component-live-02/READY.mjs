import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {binding} from './HARNESS.mjs';
const dir=dirname(fileURLToPath(import.meta.url)),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function ready(){
 const names=['selftest-final-01.json','import-final-01.json','observation-test-02.json','baseline.json','preflight.json'];
 const [selftest,imported,observation,baseline,preflight]=names.map(name=>JSON.parse(readFileSync(join(dir,name),'utf8'))),current=binding();
 for(const proof of [selftest,baseline,preflight.binding])for(const key of Object.keys(current))assert.deepEqual(proof[key],current[key]);
 assert.equal(selftest.passed,true);assert.equal(selftest.networkAttempts,0);assert.equal(selftest.positive.modelSends,3);assert.equal(selftest.positive.executions,1);assert.equal(selftest.positive.authRequests,1);
 assert.equal(imported.passed,true);assert.equal(imported.harnessSHA256,current.harnessSHA256);for(const key of ['network','writes','children'])assert.equal(imported[key],0);assert.equal(imported.environmentUnchanged,true);
 assert.equal(observation.passed,true);for(const key of Object.keys(current))assert.deepEqual(observation.binding[key],current[key]);assert.equal(observation.networkAttempts,0);assert.equal(observation.authReadAttempts,0);assert.equal(observation.tests.length,8);assert.ok(observation.tests.every(test=>test.passed));assert.equal(observation.binding.observationSHA256,sha(readFileSync(join(dir,'TEST-OBSERVATION.mjs'))));
 assert.equal(preflight.passed,true);assert.equal(preflight.networkAttempts,0);assert.equal(preflight.configUnchanged,true);assert.equal(preflight.oauthAvailable,true);assert.equal(preflight.nativeSender,true);assert.equal(preflight.proxyMode,'direct');
 assert.equal(existsSync(join(dir,'live.claim')),false);assert.equal(existsSync(join(dir,'PROJECTION.json')),false);
 const result={passed:true,binding:current,evidence:names.map(path=>({path,sha256:sha(readFileSync(join(dir,path)))})),scope:'fresh frozen SDK02 only; 2 semantic / 3 physical model / 1 tool; all earlier claims exhausted',readinessSHA256:sha(readFileSync(fileURLToPath(import.meta.url)))};
 writeFileSync(join(dir,'readiness.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});return {passed:true,evidence:result.evidence,harnessSHA256:current.harnessSHA256};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{console.log(JSON.stringify(ready()));}catch{console.log('{"passed":false,"failure":"SDK_READINESS"}');process.exitCode=1;}}
