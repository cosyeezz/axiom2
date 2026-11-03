'use strict';
const fs=require('node:fs'),net=require('node:net'),http=require('node:http'),{spawn}=require('node:child_process');
const {createPair}=require('/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02/request-pair-design-01/private_pair.cjs');
const {createSender}=require('/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02/request-pair-design-01/private_sender.cjs');
const root=__dirname, results=[], children=[];
let httpRequests=0,serverMatches=0,port=null, stage='init';
const body=JSON.stringify({systemPrompt:'固定安全指令',conversationState:{history:[{userInputMessage:{content:'历史',modelId:'deepseek-3.2'}}],currentMessage:{userInputMessage:{modelId:'deepseek-3.2',content:'受控输入',userInputMessageContext:{tools:[{toolSpecification:{name:'own_tool',description:'local test',inputSchema:{json:{type:'object'}}}}]}}}},custom:{preserve:true},security:{policy:'retain'},unknown:{nested:['值',1]}});
const check=x=>{if(!x)throw null};
const env={HOME:root,TMPDIR:root,PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'};
function spawnSender(mode,endpoint,p){
 const file=root+'/'+mode+'-result.json',argv=[root+'/child.cjs',mode,endpoint,String(p),file];
 const child=spawn(process.execPath,argv,{cwd:root,env,stdio:'ignore'});
 const info={mode,pid:child.pid,argv,exit:null,signal:null};children.push(info);
 return new Promise(resolve=>{child.on('error',()=>resolve(info));child.on('exit',(code,signal)=>{info.exit=code;info.signal=signal;resolve(info)})});
}
function connect(path){
 return new Promise((resolve,reject)=>{const s=net.createConnection({path,allowHalfOpen:true});s.on('error',()=>reject(null));s.once('connect',()=>resolve(s))});
}
const status=(source,state)=>({schema:source==='node-http'?'node-http-ram-adapter-1':'undici-ram-adapter-1',coverage:source==='node-http'?'partial-end-api-only':'diagnostic-values-only',state,fault:'none',calls:0,pending:0,records:0,candidates:0,submitted:0,naturalInstallationProved:false,requestCompletenessProved:false,wireReceiptProved:false});
async function test(id,fn){stage=id;let passed=false,evidence=null;try{evidence=await fn();passed=true}catch(_){}results.push({id,passed,evidence})}
(async()=>{
 await test('P01-cross-process',async()=>{
  let pair,server;
  try{
   server=http.createServer((req,res)=>{
    httpRequests++;const chunks=[];let n=0;
    req.on('data',b=>{n+=b.length;if(n<=262144)chunks.push(b);else req.destroy()});
    req.on('end',()=>{if(Buffer.concat(chunks).equals(Buffer.from(body,'utf8')))serverMatches++;chunks.length=0;res.end('OK')});
   });
   await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));port=server.address().port;
   pair=await createPair({deadlineMs:4000});check(pair.ready);
   const waits=[spawnSender('node',pair.endpoints.left,port),spawnSender('undici',pair.endpoints.right,port)];
   const result=await pair.result;await Promise.all(waits);
   const records=['node','undici'].map(mode=>JSON.parse(fs.readFileSync(root+'/'+mode+'-result.json','utf8')));
   const cleanup=await pair.dispose();
   check(children.length===2&&children.every(x=>x.exit===0)&&records.every(x=>x.ok));
   check(httpRequests===2&&serverMatches===2&&result.state==='candidate-pair'&&result.fault==='none');
   check(result.comparison.body.utf8.result==='equal'&&result.comparison.body.fields.currentModelId.valuesEqual===true);
   check(result.sides.every(s=>s.candidates===1&&s.readableEOF&&s.observerStates.every(x=>x==='closed')));
   check(cleanup.ownDirectoryRemoved);
   return {channel:result,cleanup,childWaits:children.map(x=>({pid:x.pid,exit:x.exit})),serverMatches};
  }finally{if(pair)await pair.dispose();if(server)await new Promise(resolve=>server.close(resolve))}
 });
 await test('P02-remote-fault',async()=>{
  const pair=await createPair({deadlineMs:1000});let sender;
  try{sender=await createSender(pair.endpoints.left,{deadlineMs:1000});sender.notifyFault('node-http');const r=await pair.result;await sender.done;check(r.state==='failed'&&r.comparison===null);return {fault:r.fault,senderFault:sender.snapshot().fault}}
  finally{sender?.abort();await pair.dispose()}
 });
 await test('P03-missing-candidate',async()=>{
  const pair=await createPair({deadlineMs:1000});const senders=[];
  try{for(const endpoint of Object.values(pair.endpoints)){const s=await createSender(endpoint,{deadlineMs:1000});senders.push(s);for(const state of ['active','closed'])for(const source of ['node-http','undici'])check(s.sendStatus(source,status(source,state)));s.finish()}
   const r=await pair.result;await Promise.all(senders.map(s=>s.done));check(r.fault==='incomplete-observation'&&r.comparison===null);return {fault:r.fault}}
  finally{senders.forEach(s=>s.abort());await pair.dispose()}
 });
 await test('P04-truncated',async()=>{
  const pair=await createPair({deadlineMs:1000});let socket;
  try{socket=await connect(pair.endpoints.left);socket.end(Buffer.from('KPR1'));const r=await pair.result;check(r.fault==='stream-fault'&&r.comparison===null);return {fault:r.fault}}
  finally{socket?.destroy();await pair.dispose()}
 });
 await test('P05-duplicate',async()=>{
  const pair=await createPair({deadlineMs:1000});const sockets=[];
  try{sockets.push(await connect(pair.endpoints.left));sockets.push(await connect(pair.endpoints.left));const r=await pair.result;check(r.fault==='unexpected-connection'&&r.sides[0].acceptedConnections===2);return {fault:r.fault,accepted:r.sides[0].acceptedConnections}}
  finally{sockets.forEach(s=>s.destroy());await pair.dispose()}
 });
 await test('P06-deadline',async()=>{
  const pair=await createPair({deadlineMs:100});let socket;
  try{socket=await connect(pair.endpoints.left);const r=await pair.result;check(r.fault==='deadline'&&r.comparison===null);const cleanup=await pair.dispose();check(cleanup.ownDirectoryRemoved);return {fault:r.fault,cleanup}}
  finally{socket?.destroy();await pair.dispose()}
 });
 fs.writeFileSync(root+'/harness-result.json',JSON.stringify({schema:1,node:process.version,platform:process.platform,arch:process.arch,pid:process.pid,results,children,httpRequests,serverMatches,port,stdio:'DEVNULL; bytes and EOF unknown'}),{flag:'wx',mode:0o600});
 process.exitCode=results.length===6&&results.every(x=>x.passed)?0:1;
})().catch(()=>{try{fs.writeFileSync(root+'/harness-failure.json',JSON.stringify({fault:'harness-fault',stage}),{flag:'wx',mode:0o600})}catch(_){}process.exitCode=2});
