'use strict';
const assert=require('node:assert/strict'),https=require('node:https'),tls=require('node:tls'),fs=require('node:fs'),{join}=require('node:path');
const {MODEL,MARKER}=require('./PROJECTION.cjs');
const scenario=process.argv[2];
const headers={'authorization':'Bearer '+process.env.CODEBUDDY_AUTH_TOKEN,'user-agent':'CLI/2.179.0 CodeBuddy/2.179.0','content-type':'application/json'};
const body={model:MODEL,reasoning_effort:'none',stream:true,max_tokens:128000,messages:[{role:'user',content:`Reply exactly ${MARKER}.`}],tools:[]};
const send=()=>{const req=https.request({hostname:'copilot.tencent.com',path:'/v2/chat/completions',method:'POST',headers},res=>{res.resume();if(scenario==='extra-model')res.once('end',()=>{try{send();process.exitCode=1;}catch{}});});req.on('error',()=>{});return req;};
try{
  if(scenario==='token-output'){console.log(process.env.CODEBUDDY_AUTH_TOKEN);}
  else if(scenario==='raw-tls'){tls.connect({host:'example.invalid',port:443});process.exitCode=1;}
  else if(scenario==='bad-host'){https.request('https://example.invalid/').end();process.exitCode=1;}
  else if(scenario==='bad-agent'){https.request({hostname:'copilot.tencent.com',path:'/v2/chat/completions',method:'POST',createConnection(){throw Error('SHOULD_NOT_RUN');}});process.exitCode=1;}
  else if(scenario==='write-escape'){
    const target=join(process.env.HOME,'../escape-'+process.pid);assert.throws(()=>fs.mkdirSync(target),/OWNED_PATH_REQUIRED/);assert.equal(fs.existsSync(target),false);
    fs.symlinkSync('/tmp',join(process.env.HOME,'link'));assert.equal(fs.existsSync(join(process.env.HOME,'link')),false);
    const stream=fs.createWriteStream(target,{fd:1});stream.end('SHOULD_NOT_APPEAR');
  }else{
    if(scenario==='bad-model')body.model='not-authorized';
    if(scenario==='bad-effort')body.reasoning_effort='high';
    if(scenario==='bad-auth')headers.authorization='Bearer SYNTHETIC-WRONG';
    const req=send();
    if(scenario==='early-flush'){req.flushHeaders();process.exitCode=1;}
    else if(scenario==='cancel'){req.destroy(Error('SYNTHETIC_CANCEL'));}
    else if(scenario==='too-large'){req.write(Buffer.alloc(1048577));process.exitCode=1;}
    else {req.end(new Uint8Array(Buffer.from(JSON.stringify(body))));if(['bad-model','bad-effort','bad-auth'].includes(scenario))process.exitCode=1;}
  }
}catch(error){if(error instanceof assert.AssertionError)process.exitCode=1;}
