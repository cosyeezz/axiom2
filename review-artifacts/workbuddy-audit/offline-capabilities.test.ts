import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createModels, Type } from '../../app/node_modules/@earendil-works/pi-ai/dist/index.js';
import { codeBuddyProvider } from '../../app/src/server/providers/codebuddy-cn.ts';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=';
const img={type:'image' as const,data:png,mimeType:'image/png'};
const ctx:any={systemPrompt:'Preserve audit constraints.',messages:[{role:'user',content:[{type:'text',text:'Inspect fixture'},img],timestamp:1}],tools:[{name:'read',description:'Read a fixture',parameters:Type.Object({path:Type.String()})}]};
const chunk=(delta:any,finish_reason:string|null=null)=>({id:'audit-mock',choices:[{index:0,delta,finish_reason}]});
const sse=(chunks:any[])=>new Response(chunks.map(c=>'data: '+JSON.stringify(c)+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
function fixture(id='glm-5.3'){const p=codeBuddyProvider(),models=createModels();models.setProvider(p);return{models,model:p.getModels().find(m=>m.id===id)!};}

test('vision model sends user image as exact data URI; text-only model strips image bytes',async()=>{
 for(const id of ['glm-5.3','glm-5.2']){const {models,model}=fixture(id);let sent:any;
 const result=await models.completeSimple(model,ctx,{apiKey:'AUDIT_FIXTURE_ONLY',maxRetries:0,maxTokens:100,fetch:async(_i,init)=>{sent=JSON.parse(String(init?.body));return sse([chunk({content:'ok'},'stop')]);}});
 assert.equal(result.stopReason,'stop',result.errorMessage);const wire=JSON.stringify(sent.messages);
 if(id==='glm-5.3'){assert.ok(wire.includes('data:image/png;base64,'+png));assert.equal(sent.messages.find((m:any)=>m.role==='user').content.filter((b:any)=>b.type==='image_url').length,1);}
 else{assert.ok(!wire.includes(png));assert.ok(!wire.includes('image_url'));}
 }
});

test('reasoning aliases survive tool round trip; tool image moves to follow-up user message',async()=>{
 for(const field of ['reasoning_content','reasoning','reasoning_text']){const {models,model}=fixture();
 const first=await models.completeSimple(model,ctx,{apiKey:'AUDIT_FIXTURE_ONLY',maxRetries:0,maxTokens:100,reasoning:'high',fetch:async()=>sse([
 chunk({[field]:'Inspect the fixture. ',content:'Reading.',tool_calls:[{index:0,id:'audit-read',type:'function',function:{name:'read',arguments:'{"path":'}}]}),
 chunk({[field]:'Use returned pixels.',tool_calls:[{index:0,function:{arguments:'"fixture.png"}'}}]},'tool_calls')])});
 assert.equal(first.stopReason,'toolUse',first.errorMessage);assert.equal(first.content.find(b=>b.type==='thinking')?.thinking,'Inspect the fixture. Use returned pixels.');
 const next:any={...ctx,messages:[...ctx.messages,first,{role:'toolResult',toolCallId:'audit-read',toolName:'read',content:[{type:'text',text:'PIXEL_FIXTURE'},img],isError:false,timestamp:2}]};let sent:any;
 const result=await models.completeSimple(model,next,{apiKey:'AUDIT_FIXTURE_ONLY',maxRetries:0,maxTokens:100,reasoning:'high',fetch:async(_i,init)=>{sent=JSON.parse(String(init?.body));return sse([chunk({content:'done'},'stop')]);}});
 assert.equal(result.stopReason,'stop',result.errorMessage);const a=sent.messages.find((m:any)=>m.role==='assistant');assert.equal(a[field],'Inspect the fixture. Use returned pixels.');assert.equal(a.tool_calls[0].id,'audit-read');assert.deepEqual(JSON.parse(a.tool_calls[0].function.arguments),{path:'fixture.png'});
 const ti=sent.messages.findIndex((m:any)=>m.role==='tool');assert.equal(sent.messages[ti].tool_call_id,'audit-read');assert.equal(sent.messages[ti].content,'PIXEL_FIXTURE');const follow=sent.messages[ti+1];assert.equal(follow.role,'user');assert.equal(follow.content.find((b:any)=>b.type==='image_url').image_url.url,'data:image/png;base64,'+png);
 }
});

test('off omits disabling signal, does not suppress returned thinking; budget is not sent',async()=>{
 const {models,model}=fixture();let sent:any;const result=await models.completeSimple(model,ctx,{apiKey:'AUDIT_FIXTURE_ONLY',maxRetries:0,maxTokens:100,reasoning:'off',thinkingBudgets:{high:7777},fetch:async(_i,init)=>{sent=JSON.parse(String(init?.body));return sse([chunk({reasoning_content:'upstream default thinking',content:'ok'},'stop')]);}});
 assert.equal(result.stopReason,'stop',result.errorMessage);assert.equal(sent.reasoning_effort,undefined);assert.equal(sent.reasoning_summary,undefined);assert.equal(sent.max_thinking_tokens,undefined);assert.equal(result.content.find(b=>b.type==='thinking')?.thinking,'upstream default thinking');
 const high=await models.completeSimple(model,ctx,{apiKey:'AUDIT_FIXTURE_ONLY',maxRetries:0,maxTokens:100,reasoning:'high',thinkingBudgets:{high:7777},fetch:async(_i,init)=>{sent=JSON.parse(String(init?.body));return sse([chunk({content:'ok'},'stop')]);}});assert.equal(high.stopReason,'stop',high.errorMessage);assert.equal(sent.reasoning_effort,'high');assert.equal(sent.max_thinking_tokens,undefined);assert.equal(sent.thinking,undefined);assert.equal(sent.reasoning,undefined);
});

test('missing finish and finish_reason error cannot be mistaken for success',async()=>{
 const {models,model}=fixture();for(const finish of [null,'error']){const result=await models.completeSimple(model,ctx,{apiKey:'AUDIT_FIXTURE_ONLY',maxRetries:0,maxTokens:100,fetch:async()=>sse([chunk({content:'partial'},finish)])});assert.equal(result.stopReason,'error');}
});
