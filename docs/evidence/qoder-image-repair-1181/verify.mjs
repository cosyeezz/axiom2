import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,relative} from 'node:path';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..');
const text=name=>readFileSync(resolve(here,name),'utf8');
const json=name=>JSON.parse(text(name));
const check=json('checks.json'), original=json('case-contract.json'), postfix=json('postfix-contract.json');
assert.equal(original.maxModelInvocations,8);
assert.equal(check.imageGroup.logicalCalls.length,8);
assert.equal(new Set(check.imageGroup.logicalCalls).size,8);
assert.equal(check.imageGroup.remaining,0);
assert.equal(postfix.maxModelInvocations,0);
assert.equal(postfix.maxUploadRequests,1);
assert.equal(check.accurateImageRecognitionAccepted,false);
assert.equal(check.actualWorkerImageToolContinuationAccepted,false);
for(const file of ['cli-before-01.json','cli-diagnostic-02.json','native-before-01.json','remote-probe-08.json'])assert.equal(json(file).accepted,false);
const cli=json('cli-diagnostic-02.json');
assert.equal(cli.numTurns,1);assert.equal(cli.codeExact,false);assert.equal(cli.itemsExact,false);
const native=json('native-before-01.json');
assert.equal(native.stopReason,'stop');assert.equal(native.deniedVision,true);
assert.equal(native.requests.find(r=>r.modelKey==='dfmodel').inlineImageExact,true);
const remote=json('remote-probe-08.json'),sse=remote.requests.find(r=>r.modelKey==='dfmodel');
assert.equal(remote.actualInferenceCalls,1);assert.equal(sse.status,200);
assert.ok(sse.sseShapes.some(s=>s.wrapperStatus===406&&s.code===406&&s.codeType==='string'));
const identity=json('identity-preflight-08.json');
assert.equal(identity.actualInferenceCalls,0);assert.equal(identity.inferenceBlocked,true);
for(const name of ['Cosy-MachineId','Cosy-User','Cosy-Data-Policy','Login-Version','Cosy-Version'])assert.equal(identity.identityMatches[name].match,true);
assert.equal(identity.identityMatches['Cosy-Key'].match,false); // Per-request randomized key, not an identity mismatch.
assert.equal(json('upload-integrity-07.json').imageGet.exactImageBytes,true);
const pre=json('cli-preflight-06-body.json');
assert.equal(pre.inferenceSent,false);assert.equal(pre.images[0].kind,'remote');
const product=json('compiled-upload-preflight-01.json');
assert.equal(product.uploadAccepted,true);assert.equal(product.visionAccepted,false);
assert.equal(product.actualInferenceCalls,0);assert.equal(product.actualToolExecutions,0);
assert.equal(product.blockedInferenceAttempts,0);assert.equal(product.uploadRequests,1);assert.equal(product.hookCalls,1);
assert.equal(product.stoppedBeforeInference,true);assert.equal(product.originalContextUnchanged,true);
assert.equal(product.finalPayload.remoteOnly,true);assert.equal(product.finalPayload.contentContentsMatch,true);
assert.equal(product.imageGet.status,200);assert.equal(product.imageGet.exactImageBytes,true);
assert.equal(json('ram-diagnostic-cleared.json').cleared,true);
const restart=json('restart.json');assert.equal(restart.phase,'verified');assert.equal(restart.http,200);assert.equal(restart.websocket,'connected');
assert.equal(restart.oldPid,96136);assert.equal(restart.newPid,5441);
const outcomes=name=>[...text(name).matchAll(/^(ok|not ok) \d+ - (.+)$/gm)].map(m=>({pass:m[1]==='ok',name:m[2]}));
const first=outcomes('image-regression-01.log'),last=outcomes('image-regression-03.log');
assert.equal(first.length,59);assert.equal(first.filter(r=>!r.pass).length,1);
assert.equal(last.length,9);assert.ok(last.every(r=>r.pass));
const names=new Set(last.map(r=>r.name)),old=first.filter(r=>!names.has(r.name));
assert.equal(old.length,50);assert.ok(old.every(r=>r.pass));
assert.ok(names.has(first.find(r=>!r.pass).name));
assert.match(text('build-image-01.log'),/TS2339/);
assert.match(text('build-image-02.log'),/tsc --noEmit && vite build && tsc -p tsconfig.server.json/);
assert.doesNotMatch(text('build-image-02.log'),/error TS\d+/);
for(const artifact of ['image-regression-01.log','image-regression-03.log','build-image-01.log','build-image-02.log'])assert.ok(check.commands.some(c=>c.artifact===artifact&&Number.isInteger(c.exitCode)));
const reports=readdirSync(here).filter(n=>n.endsWith('.json')&&!['snapshot.json','verification.json'].includes(n));
for(const name of reports){
 const value=text(name);JSON.parse(value);
 assert.doesNotMatch(value,/https?:\/\/|Bearer\s+|\b(?:dt|pt)-[A-Za-z0-9_-]{8,}/,`${name}: no stored URLs or credentials`);
}
const doc=resolve(root,'docs/qoder-image-repair-1181.md');
const links=[...readFileSync(doc,'utf8').matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map(m=>m[1]);
for(const link of links)if(!/^[a-z]+:/i.test(link))assert.ok(existsSync(resolve(dirname(doc),link.split('#')[0])),`missing link: ${link}`);
const files=[
 'app/src/server/providers/qoder-images.ts','app/src/server/providers/qoder.ts','app/src/server/providers/qoder-protocol.ts',
 'app/tests/qoder-images.test.ts','app/tests/qoder-stream.test.ts','app/tests/qoder-parity.test.ts',
 'docs/qoder.md','docs/qoder-client-parity.md','docs/qoder-repair-1181.md','docs/qoder-image-repair-1181.md',
 ...readdirSync(here).filter(n=>!['snapshot.json','verification.json'].includes(n)).map(n=>relative(root,resolve(here,n))),
].sort();
const digest=path=>createHash('sha256').update(readFileSync(resolve(root,path))).digest('hex');
if(process.argv.includes('--capture'))writeFileSync(resolve(here,'snapshot.json'),JSON.stringify({scope:'Post-verification source and archive snapshot, not a start-of-test freeze proof',files:Object.fromEntries(files.map(path=>[path,digest(path)]))},null,2)+'\n',{flag:'wx'});
const snapshot=json('snapshot.json');
for(const [path,hash] of Object.entries(snapshot.files))assert.equal(digest(path),hash,`snapshot changed: ${path}`);
const result={scope:'Offline archive and source snapshot only; no network or model calls',linkedPaths:links.length,jsonReports:reports.length,snapshottedFiles:Object.keys(snapshot.files).length,unchangedFiveFileTests:50,newImageFileTests:9,oldGroupLogicalCalls:8,oldGroupRemaining:0,postfixInferenceCalls:0,compiledUploadAccepted:true,accurateImageRecognitionAccepted:false,actualWorkerImageToolContinuationAccepted:false};
writeFileSync(resolve(here,'verification.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
