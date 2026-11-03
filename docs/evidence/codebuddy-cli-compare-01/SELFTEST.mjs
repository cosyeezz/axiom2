import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Socket} from 'node:net';
import {run,binding} from './OFFICIAL-RUN.mjs';
import {openRuntime,sha} from './RUNTIME.mjs';
import projection from './PROJECTION.cjs';
const dir=dirname(fileURLToPath(import.meta.url));
async function test(prefix){
  const cases=[['valid',undefined,1],['bad-model','MODEL_PARAMETERS',0],['bad-effort','MODEL_PARAMETERS',0],['bad-auth','MODEL_PARAMETERS',0],['bad-host','REQUEST_DESTINATION',0],['bad-agent','TRANSPORT_OVERRIDE',0],['early-flush','EARLY_FLUSH',0],['too-large','REQUEST_BYTES',0],['raw-tls','TLS_DESTINATION',0],['cancel','TRANSPORT_ERROR',0],['extra-model','MODEL_BUDGET',1],['write-escape',undefined,0],['token-output',undefined,0]],results=[];
  for(const [scenario,failure,models]of cases){const file=`${prefix}-${scenario}.json`,result=await run({output:file,driver:join(dir,'GUARD-DRIVER.cjs'),scenario});results.push({scenario,passed:result.exit?.code===0&&result.observation?.failure===failure&&result.fixtureModels===models&&result.cleaned&&result.observation?.activeRequests===0&&(scenario!=='token-output'||result.tokenInOutput===true&&!result.passed),file,sha256:sha(readFileSync(join(dir,file)))});}
  const {MARKER,MODEL,responseProjection}=projection,chunk=(content,finish=null)=>`data: ${JSON.stringify({model:MODEL,choices:[{index:0,delta:{content},finish_reason:finish}]})}\n\n`,headers={'content-type':'text/event-stream'};
  const complete=chunk(MARKER.slice(0,3))+chunk(MARKER.slice(3),'stop')+'data: [DONE]\n\n';
  assert.equal(responseProjection(Buffer.from(complete),headers).strictTerminal,true);
  assert.equal(responseProjection(Buffer.from(chunk('EXTRA'+MARKER,'stop')+'data: [DONE]\n\n'),headers).strictTerminal,false);
  assert.equal(responseProjection(Buffer.from(complete+chunk('EXTRA')),headers).strictTerminal,false);
  assert.equal(responseProjection(Buffer.from(complete+'data: [DONE]\n\n'),headers).strictTerminal,false);
  assert.equal(JSON.stringify(responseProjection(Buffer.from('data: {"error":{"code":123,"message":"NEVER_PERSIST"}}\n\n'),headers)).includes('NEVER_PERSIST'),false);
  const temporary=mkdtempSync(join(tmpdir(),'codebuddy-auth-fixture-')),auth={refreshRequests:0};let context,networkAttempts=0;const original=Socket.prototype.connect;Socket.prototype.connect=function(){networkAttempts++;throw Error('SELFTEST_NETWORK');};
  try{context=await openRuntime({live:false,temporary,state:auth});assert.equal(context.access,'SYNTHETIC-ACCESS');assert.equal(auth.refreshRequests,1);assert.equal((await context.readCredential()).refresh,'SYNTHETIC-ROTATED');await context.close();context=undefined;assert.equal(networkAttempts,0);}finally{await context?.close();Socket.prototype.connect=original;rmSync(temporary,{recursive:true,force:true});}
  const result={passed:results.every(item=>item.passed),results,projectionChecks:5,auth,networkAttempts,binding:binding(),driverSHA256:sha(readFileSync(join(dir,'GUARD-DRIVER.cjs'))),selftestSHA256:sha(readFileSync(fileURLToPath(import.meta.url)))};writeFileSync(join(dir,`${prefix}-summary.json`),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)test(process.argv[2]??'guards-01').then(result=>{console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;}).catch(()=>{console.log('{"passed":false,"failure":"SELFTEST_ERROR"}');process.exitCode=1;});
