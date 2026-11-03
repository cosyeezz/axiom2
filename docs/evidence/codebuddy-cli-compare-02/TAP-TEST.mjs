import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import tap from './RESPONSE-TAP.cjs';
import projection from './PROJECTION.cjs';
import {binding} from './OFFICIAL-RUN.mjs';
const {MODEL,MARKER}=projection,dir=dirname(fileURLToPath(import.meta.url));
const frame=(delta,finish_reason='')=>'data: '+JSON.stringify({model:MODEL,choices:[{index:0,delta,finish_reason}]})+'\n\n';
const partial=frame({role:'assistant',content:'',function_call:null,tool_calls:null,reasoning_content:null,refusal:null});
const full=partial+frame({content:MARKER})+frame({},'stop')+'data: [DONE]\n\n';
const results=[];
for(const [name,body,exit,complete] of [['eof',full,'end',true],['done-abort',full,'aborted',true],['done-close',full,'close',true],['done-error',full,'error',true],['done-abort-reset',full,'aborted',true],['done-abort-unknown-error',full,'aborted',true],['early-abort',partial,'aborted',false],['early-error',partial,'error',false],['early-close',partial,'close',false],['partial-json',partial+'data: {','aborted',false]]){
  const response=new EventEmitter(),record={},failures=[];response.headers={'content-type':'text/event-stream'};response.destroy=()=>{};response.on('error',()=>{});tap(response,record,'model',code=>failures.push(code));response.emit('data',Buffer.from(body));response.emit(exit);if(name==='done-abort-reset')response.emit('error',Object.assign(new Error('synthetic'),{code:'ECONNRESET'}));if(name==='done-abort-unknown-error')response.emit('error',new Error('synthetic'));response.emit('close');
  assert.equal(record.responseExit,exit);assert.equal(record.responseBytes,Buffer.byteLength(body));assert.equal(record.protocolComplete,complete);assert.equal(record.transportComplete,exit==='end');assert.equal(failures.length===0,complete&&!['done-close','done-error','done-abort-unknown-error'].includes(name));assert.equal(record.response.frames[0].choices[0].deltaShapes.function_call,'null');assert.equal(record.response.frames[0].choices[0].finishShape,'empty-string');assert.equal(record.response.frames[0].choices[0].deltaShapes.role,'string');results.push({name,passed:true,record,failures});
}
const result={passed:true,scope:'synthetic IncomingMessage event ordering; full CLI cancellation separately tested',results,binding:binding()};writeFileSync(join(dir,process.argv[2]??'tap-proof-01.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({passed:true,tests:results.length}));
