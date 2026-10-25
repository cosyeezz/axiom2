// Offline characterization only: no credentials, fetch, official CLI or model execution.
import assert from "node:assert/strict";
import { writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { normalizeContext, type Context, type AssistantMessage, type Model } from "../../../app/node_modules/@earendil-works/pi-ai/dist/index.js";
import { isRetryableAssistantError } from "../../../app/node_modules/@earendil-works/pi-ai/dist/utils/retry.js";
import { isContextOverflow } from "../../../app/node_modules/@earendil-works/pi-ai/dist/utils/overflow.js";
import { kiroChatRequest, kiroChatFailure, kiroStreamFailure } from "../../../app/src/server/providers/kiro-chat-protocol.js";
const model: Model<"kiro-chat"> = { id: "synthetic-model", name: "Synthetic", api: "kiro-chat", provider: "kiro", baseUrl: "https://q.us-east-1.amazonaws.com", input: ["text", "image"], reasoning: false, contextWindow: 100000, maxTokens: 8192, cost: {input:0,output:0,cacheRead:0,cacheWrite:0} };
const account = {type:"oauth" as const,access:"SYNTHETIC-NOT-A-TOKEN",refresh:"SYNTHETIC",expires:4102444800000,authMethod:"builder-id" as const,authRegion:"us-east-1"};
const usage = {input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
const user = (content="hello") => ({role:"user" as const,content,timestamp:1});
const tool = {name:"read",description:"Read synthetic file",parameters:{type:"object" as const,properties:{path:{type:"string"}},required:["path"]}};
const assistant = (content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"]="stop"): AssistantMessage => ({role:"assistant",api:model.api,provider:model.provider,model:model.id,content,stopReason,usage,timestamp:2});
const call = assistant([{type:"toolCall",id:"c1",name:"read",arguments:{path:"synthetic"}}],"toolUse");
const result = (content: {type:"text";text:string}[]) => ({role:"toolResult" as const,toolCallId:"c1",toolName:"read",content,isError:false,timestamp:3});
const request = (messages: Context["messages"]) => kiroChatRequest(model,normalizeContext({systemPrompt:"Synthetic Axiom system",tools:[tool],messages}),account,"synthetic-stable-session");
const checks: {name:string;passed:true;observation:unknown}[]=[];
function check(name:string, test:()=>unknown) {const observation=test();checks.push({name,passed:true,observation});}
check("request-skeleton-and-stable-session",()=>{
  const a=request([user()]).payload,b=request([user()]).payload;
  assert.equal(a.conversationState.conversationId,b.conversationState.conversationId);
  assert.deepEqual(Object.keys(a),["conversationState"]);
  const u=a.conversationState.currentMessage.userInputMessage;
  assert.equal(u.origin,"KIRO_CLI");assert.equal(u.modelId,model.id);
  assert.equal(u.content,"<axiom_system>\nSynthetic Axiom system\n</axiom_system>\n\nhello");
  assert.deepEqual(Object.keys(u.userInputMessageContext??{}),["tools"]);
  return {rootFields:Object.keys(a),currentContextFields:Object.keys(u.userInputMessageContext??{}),systemPlacement:"first user text prefix",stableConversationId:true};
});
check("thinking-is-not-native-replay",()=>{
  const thinking=assistant([{type:"thinking",thinking:"synthetic visible reasoning",thinkingSignature:"SYNTHETIC-SIGNATURE"},{type:"text",text:"answer"}]);
  const p=request([user(),thinking,user("next")]);
  const a=p.payload.conversationState.history!.find(x=>"assistantResponseMessage" in x)!;
  assert.ok("assistantResponseMessage" in a);assert.match(a.assistantResponseMessage.content,/<axiom_prior_reasoning>/);
  assert.equal("reasoningContent" in a.assistantResponseMessage,false);
  assert.ok(!JSON.stringify(p.payload).includes("SYNTHETIC-SIGNATURE"));
  return p.historyNotice;
});
check("user-image-native-serialization",()=>{
  const p=request([{role:"user",content:[{type:"image",data:"AA==",mimeType:"image/png"}],timestamp:1}]).payload;
  const images=p.conversationState.currentMessage.userInputMessage.images;
  assert.deepEqual(images,[{format:"png",source:{bytes:"AA=="}}]);
  return {images,note:"synthetic bytes verify encoding, not image decoding or service acceptance"};
});
check("empty-tool-result-replaced",()=>{
  const p=request([user(),call,result([])]).payload;
  const r=p.conversationState.currentMessage.userInputMessage.userInputMessageContext!.toolResults![0];
  assert.deepEqual(r,{toolUseId:"c1",status:"success",content:[{text:"(empty tool result)"}]});
  return r;
});
check("multiple-tool-text-blocks-preserved",()=>{
  const p=request([user(),call,result([{type:"text",text:"a"},{type:"text",text:"b"}])]).payload;
  const r=p.conversationState.currentMessage.userInputMessage.userInputMessageContext!.toolResults![0];
  assert.deepEqual(r,{toolUseId:"c1",status:"success",content:[{text:"a"},{text:"b"}]});
  return r;
});
check("aborted-assistant-with-retained-result-rejected",()=>{
  assert.throws(()=>request([user(),{...call,stopReason:"aborted"},result([{type:"text",text:"cancelled"}])]),/缺少匹配/);
  return "provider rejects this supplied transcript; does not prove normal UI supplies it";
});
check("http-400-loses-overflow-classification",()=>{
  const message={...assistant([],"error"),errorMessage:kiroChatFailure(400).message};
  assert.equal(isContextOverflow(message),false);
  assert.equal(isContextOverflow({...message,errorMessage:"Input is too long."}),false);
  assert.equal(isContextOverflow({...message,errorMessage:"prompt is too long"}),true);
  return {mappedMessage:message.errorMessage,classifiedAsOverflow:false,historicalRawKiroTextWouldMatch:false,normalizedOverflowCategoryWouldMatch:true};
});
check("quota-and-throttle-mapping-is-retryable-to-pi",()=>{
  const a={...assistant([],"error"),errorMessage:kiroChatFailure(429).message};
  const b={...a,errorMessage:kiroStreamFailure("ServiceQuotaExceededException").message};
  assert.equal(isRetryableAssistantError(a),true);assert.equal(isRetryableAssistantError(b),true);
  return {http429Retryable:true,serviceQuotaExceededRetryable:true,note:"classifier only; actual agent settings/loop determine retries"};
});
const sources=["../../../app/src/server/providers/kiro-chat-protocol.ts","../../../app/node_modules/@earendil-works/pi-ai/dist/utils/retry.js","../../../app/node_modules/@earendil-works/pi-ai/dist/utils/overflow.js"].map(relative=>({relative,sha256:createHash("sha256").update(readFileSync(new URL(relative,import.meta.url))).digest("hex")}));
const output={scope:"Offline adapter characterization, not an official wire golden comparison or account/API acceptance test",checksPassed:checks.length,checks,sources};
writeFileSync(new URL("./adapter-probe.json",import.meta.url),JSON.stringify(output,null,2)+"\n");
console.log(JSON.stringify(output,null,2));
