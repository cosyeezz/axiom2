import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {binding} from './OFFICIAL-RUN.mjs';
import {sha,frozenRuntime} from './RUNTIME.mjs';
const dir=dirname(fileURLToPath(import.meta.url));
function ready(){
 const current=binding(),names=['official-fixture-02.json','official-cancel-02.json','tap-proof-02.json','guards-02-summary.json','import-proof-02.json'];
 const [fixture,cancel,tap,guards,imports]=names.map(name=>JSON.parse(readFileSync(join(dir,name),'utf8')));
 for(const proof of [fixture,cancel,tap,guards,imports])assert.deepEqual(proof.binding,current);
 for(const proof of [fixture,cancel]){assert.equal(proof.passed,true);assert.equal(proof.tokenInOutput,false);assert.equal(proof.cleaned,true);assert.equal(proof.observation.modelSends,1);assert.equal(proof.observation.activeRequests,0);assert.equal(proof.assistantExact,true);}
 const cancelled=cancel.observation.requests.find(request=>request.kind==='model');assert.equal(cancel.fixtureHold,true);assert.equal(cancelled.protocolComplete,true);assert.equal(cancelled.transportComplete,false);assert.equal(cancelled.responseExit,'aborted');
 assert.equal(tap.passed,true);assert.equal(tap.results.length,10);assert.equal(guards.passed,true);assert.equal(guards.results.length,13);assert.equal(guards.auth.refreshRequests,1);assert.equal(guards.networkAttempts,0);assert.equal(imports.importResult.passed,true);assert.equal(imports.importExitCode,0);
 for(const file of guards.results)assert.equal(sha(readFileSync(join(dir,file.file))),file.sha256);
 assert.equal(sha(readFileSync(join(dir,'GUARD-DRIVER.cjs'))),guards.driverSHA256);assert.equal(sha(readFileSync(join(dir,'SELFTEST.mjs'))),guards.selftestSHA256);
 assert.equal(existsSync(join(dir,'official-live-claim.json')),false);frozenRuntime();
 const result={passed:true,binding:current,evidence:names.map(path=>({path,sha256:sha(readFileSync(join(dir,path)))})),contractSHA256:sha(readFileSync(join(dir,'CONTRACT.md'))),scope:'official supplemental stream observation only; protocol completeness separate from transport EOF; all prior claims exhausted'};
 writeFileSync(join(dir,'official-readiness.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{console.log(JSON.stringify(ready()));}catch{console.log('{"passed":false,"failure":"READINESS_CHECK"}');process.exitCode=1;}}
