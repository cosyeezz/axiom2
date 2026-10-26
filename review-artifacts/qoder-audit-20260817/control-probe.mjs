// Isolated mock-transport probe of current Axiom code; no supplier requests or real credentials.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import net from 'node:net';
import {qoderProvider} from '../../app/src/server/providers/qoder.ts';
import {decodeQoderBody} from '../../app/src/server/providers/qoder-protocol.ts';
import {createModels} from '../../app/node_modules/@earendil-works/pi-ai/dist/index.js';
net.Socket.prototype.connect=()=>{throw Error('OFFLINE probe: unexpected socket');};
const originalFetch=globalThis.fetch;
const requests=[];
const config={key:'audit-reasoning-vision',display_name:'Mock reasoning vision',enable:true,source:'system',is_reasoning:true,is_vl:true,max_input_tokens:200000,max_output_tokens:10000,efforts:['low','high'],supports_disabled:true,default_effort:'high',available_context_windows:[128000,200000],default_context_window:128000};
const json=x=>new Response(JSON.stringify(x),{headers:{'content-type':'application/json'}});
const transport=async(input,init)=>{
 const url=new URL(String(input));
 if(!['openapi.qoder.sh','center.qoder.sh','api1.qoder.sh'].includes(url.hostname))throw Error('Unexpected origin');
 if(url.pathname.endsWith('exchange'))return json({token:'jt-FIXTURE',expires_at:new Date(Date.now()+3600000).toISOString()});
 if(url.pathname.endsWith('userinfo'))return json({id:'fixture-user'});
 if(url.pathname.endsWith('endpoints'))return json({inferNodes:['https://api1.qoder.sh']});
 if(url.pathname.endsWith('model/list'))return json({chat:[config,{key:'numeric-disabled',enable:0,source:'system'},{key:'hidden-byok',source:'user'}]});
 if(url.pathname.endsWith('agent_chat_generation')){
  requests.push(JSON.parse(decodeQoderBody(String(init.body))));
  const chunk={choices:[{index:0,delta:{content:'fixture'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:1}};
  return new Response(`data: ${JSON.stringify({statusCodeValue:200,body:JSON.stringify(chunk)})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
 }
 throw Error('Unexpected endpoint');
};
globalThis.fetch=transport;
try {
 const provider=qoderProvider('intl');
 await provider.refreshModels({allowNetwork:true,credential:{type:'api_key',key:'pt-FIXTURE'},signal:new AbortController().signal,publish:async p=>{p.update?.();return true;}});
 const models=createModels();models.setProvider(provider);
 const model=provider.getModels().find(x=>x.id===config.key);
 const openaiPayloads=[];
 for(const effort of ['high','none']){
  const response=await models.completeSimple(model,{messages:[{role:'user',content:'mock only',timestamp:1}]},{apiKey:'pt-FIXTURE',fetch:transport,maxTokens:300,temperature:0.25,reasoning:effort==='none'?'off':'high',sessionId:'audit-session',onPayload(body){
   Object.assign(body,{reasoning_effort:effort,reasoning_budget_tokens:4096,enable_thinking:effort!=='none',top_p:0.8,tool_choice:'required',context_length:128000});
   openaiPayloads.push(structuredClone(body));return body;
  }});
  assert.equal(response.stopReason,'stop',response.errorMessage);
 }
 assert.equal(model.reasoning,false);assert.deepEqual(model.input,['text']);
 for(const payload of requests){assert.deepEqual(payload.parameters,{max_tokens:300});assert.equal(payload.model_config.is_reasoning,true);assert.equal(payload.session_id,'audit-session');}
 const result={scope:'mock transport only; onPayload injects controls to isolate final requestBody projection',catalog:provider.getModels().map(x=>({id:x.id,reasoning:x.reasoning,input:x.input,contextWindow:x.contextWindow,maxTokens:x.maxTokens})),openaiPayloads:openaiPayloads.map(x=>({temperature:x.temperature,reasoning_effort:x.reasoning_effort,enable_thinking:x.enable_thinking,top_p:x.top_p,tool_choice:x.tool_choice,context_length:x.context_length})),wire:requests.map(x=>({parameters:x.parameters,is_reasoning:x.model_config.is_reasoning,session_id:x.session_id})),observations:{controlsDropped:true,offDoesNotDisableCatalogReasoning:true,numericDisabledListed:provider.getModels().some(x=>x.id==='numeric-disabled')}};
 writeFileSync(new URL('control-probe.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
} finally {globalThis.fetch=originalFetch;}
