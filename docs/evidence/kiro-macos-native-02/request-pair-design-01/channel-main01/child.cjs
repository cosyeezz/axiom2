'use strict';
const fs=require('node:fs'), http=require('node:http');
const {createSender}=require('/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02/request-pair-design-01/private_sender.cjs');
const [mode,endpoint,port,file]=process.argv.slice(2);
const body=JSON.stringify({systemPrompt:'固定安全指令',conversationState:{history:[{userInputMessage:{content:'历史',modelId:'deepseek-3.2'}}],currentMessage:{userInputMessage:{modelId:'deepseek-3.2',content:'受控输入',userInputMessageContext:{tools:[{toolSpecification:{name:'own_tool',description:'local test',inputSchema:{json:{type:'object'}}}}]}}}},custom:{preserve:true},security:{policy:'retain'},unknown:{nested:['值',1]}});
let sender,agent,ok=false,done=null;
(async()=>{
 try{
  sender=await createSender(endpoint,{deadlineMs:4000});
  if(!sender.ready||!sender.installObservers())throw null;
  if(mode==='node'){
   await new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port:Number(port),path:'/v1/responses',method:'POST',headers:{'content-type':'application/json'}},res=>{
     res.on('error',reject);res.resume();res.on('end',()=>res.statusCode===200?resolve():reject(null));
    });req.on('error',reject);req.end(body);
   });
  }else{
   const {fetch,Agent}=require('/Volumes/D_Work/axiom2/app/node_modules/undici');
   agent=new Agent();
   const res=await fetch('http://127.0.0.1:'+port+'/',{method:'POST',headers:{'content-type':'application/json','x-amz-target':'AmazonCodeWhispererStreamingService.GenerateAssistantResponse'},body,redirect:'error',dispatcher:agent});
   await res.arrayBuffer();if(res.status!==200)throw null;
  }
  sender.closeObservers();if(!sender.finish())throw null;
  done=await sender.done;
  ok=done.fault==='none'&&done.state==='closed'&&done.candidates===1&&done.observerStatuses.every(s=>s.state==='closed'&&s.fault==='none');
 }catch(_){}
 finally{
  try{sender?.closeObservers();if(!ok)sender?.abort();if(sender)await sender.done;}catch(_){}
  try{if(agent)await agent.close();}catch(_){}
  fs.writeFileSync(file,JSON.stringify({schema:1,mode,pid:process.pid,node:process.version,ok,sender:sender?sender.snapshot():null}),{flag:'wx',mode:0o600});
  process.exitCode=ok?0:1;
 }
})().catch(()=>{process.exitCode=2});
