Official CLI 2.179.0 headless; 0-based byte half-open ranges. Static only.

## reasoning-projection [22809424,22809621)
```js
else if("reasoning"===ef.type){eh?.content!==null&&flushAssistantMessage(),eu=ef.rawContent?.[0]?.text,ep=openaiChatCompletionsConverter_mergeExtraFields(ep,ef.providerData?.extra_fields);continue}
```

## pending-reasoning [22807334,22807500)
```js
applyPendingReasoning=eA=>{eu&&(eA.reasoning=eu,eu=null);let el=openaiChatCompletionsConverter_mergeExtraFields(eA.extra_fields,ep);el&&(eA.extra_fields=el),ep=null},
```

## tool-pairing [22810836,22812231)
```js
else if("function_call"===ef.type){if(ef.caller?.type==="program")throw new nm.UserError("Programmatic Tool Calling history is not supported for chat completions. Please use the Responses API.");if("string"==typeof ef.namespace&&ef.namespace.trim().length>0)throw new nm.UserError("Namespaced function call history is not supported for chat completions. Please use the Responses API when replaying namespaced tool calls.");let eA=ensureAssistantMessage(),el=eA.tool_calls??[],ed=ef,{extra_fields:eu,...ep}=ed.providerData??{},eh=getProviderDataWithoutReservedKeys(ep,["role","content","tool_calls","audio","id","type","function"]);el.push({id:ed.callId,type:"function",function:{name:ed.name,arguments:ed.arguments??"{}"}}),eA.tool_calls=el,Object.assign(eg,eh),Object.assign(eA,eh),ec=openaiChatCompletionsConverter_mergeExtraFields(ec,eu);let em=openaiChatCompletionsConverter_mergeExtraFields(eA.extra_fields,eu);em?eA.extra_fields=em:delete eA.extra_fields}else if("function_call_result"===ef.type){if(ef.caller?.type==="program")throw new nm.UserError("Programmatic Tool Calling history is not supported for chat completions. Please use the Responses API.");flushAssistantMessage();let eA=ef,ec=normalizeFunctionCallOutputForChat(eA.output,el);ed.push({role:"tool",tool_call_id:eA.callId,content:ec,...getProviderDataWithoutReservedKeys(eA.providerData,["role","tool_call_id","content"])})}
```

## responses-only-id-normalizer [7267216,7267464)
```js
function normalizeCallId(eA){if("string"!=typeof eA)return eA;let el=eA.replace(/[^a-zA-Z0-9_-]/g,"_").slice(0,64);return el.replace(/_+$/,"")||el}function isForeign(eA,el){let ec=eA.providerData?.upstream?.model;return"string"==typeof ec&&ec!==el}
```

## responses-wrapper [7271177,7271608)
```js
function withResponsesWire(eA,el,ec){let prepare=async eA=>{let ed="string"==typeof eA.input?eA.input:toResponsesInput(eA.input,el);return"string"!=typeof ed&&ec.resolveImages&&(ed=await ec.resolveImages(ed)),{...eA,input:ed,modelSettings:toResponsesModelSettings(eA.modelSettings,ec)}};return{getResponse:async el=>eA.getResponse(await prepare(el)),async *getStreamedResponse(el){yield*eA.getStreamedResponse(await prepare(el))}}}
```

## reasoning-backfill [15005622,15006499)
```js
let ReasoningContentBackfillRule=class ReasoningContentBackfillRule{constructor(){this.name="reasoning-content-backfill"}matches(eA){let el=eA.caps;return!!el&&(!0===el.requiresReasoningContentOnAssistantMessages||!0===eA.thinkingEnabled&&"string"==typeof el.compat?.reasoningContentPlaceholder)}apply(eA,el){if(!Array.isArray(eA.messages))return;let ec=el.caps?.requiresReasoningContentOnAssistantMessages===!0&&eA.messages.some(eA=>eA&&"assistant"===eA.role&&"string"==typeof eA.reasoning&&eA.reasoning.length>0);if(!el.thinkingEnabled&&!ec)return;let ed=el.caps?.compat?.reasoningContentPlaceholder,eu="string"==typeof ed?ed:"";for(let el of eA.messages)"assistant"===el.role&&("string"!=typeof el.reasoning_content&&"string"==typeof el.reasoning&&el.reasoning.length>0&&(el.reasoning_content=el.reasoning),"string"!=typeof el.reasoning_content&&(el.reasoning_content=eu))}}
```

## empty-content [7381364,7382090)
```js
sanitizeEmptyContent(eA){for(let el=eA.length-1;el>=0;el--){let ec=eA[el],ed=ec.content;(null==ed||Array.isArray(ed)&&0===ed.length||""===ed)&&("assistant"===ec.role&&ec.tool_calls?.length>0?delete ec.content:"assistant"===ec.role&&this.hasReasoningPayload(ec)?ec.content="":"assistant"===ec.role?(this.logger.debug(`Removed assistant message at index ${el} with empty content and no tool_calls`),eA.splice(el,1)):"user"===ec.role&&(this.logger.warn(`[cbc-kw=MODEL_REQUEST] [sanitizeEmptyContent] Removed user message at index ${el} with empty content`),eA.splice(el,1)))}}hasReasoningPayload(eA){return"string"==typeof eA.reasoning&&eA.reasoning.length>0||"string"==typeof eA.reasoning_content&&eA.reasoning_content.length>0}
```

## chat-request-construction [22822072,22822400)
```js
lSettings.parallelToolCalls,ef=itemsToMessages(eA.input,{strictFeatureValidation:this.#r1});eA.systemInstructions&&ef.unshift({content:eA.systemInstructions,role:"system"}),el&&!0===eA.tracing&&(el.spanData.input=ef);let em={...eA.modelSettings.providerData??{}},ey=eA._internal,eE=ey?.reasoningEffortImplicit===!0&&(void 0!==em
```

## wire-selection [7356980,7357400)
```js
se:this.modelRequestRetryPhase,log:eA=>this.logger.warn(eA)}):eC,eb=this.aiccModelBoundary?.wrapModel(ev,eA)??ev,e_=(0,oS.stripCustomLocalModelPrefix)(eA),eI=em?withResponsesWire(eb,e_,{store:await isResponsesStoreEnabled(this.abTestService),encryptedReasoning:eh?.supportsReasoning===!0,resolveImages:eA=>resolveResponsesImages(eA,this.responsesImageDeps(eh))}):eb,eB=resolveRawApiBodies(),eS=eB?withRawApiBodies(eI,eB,
```

## responses-rebuild-call-and-result [7269808,7270294)
```js
geItem(eA))return rebuildInputMessage(eA);if("function_call"===eA.type){let ec=isForeign(eA,el)?void 0:upstreamItemId(eA,"fc_");return{type:"function_call",...ec?{id:ec}:{},callId:normalizeCallId(eA.callId),name:eA.name,arguments:eA.arguments,..."string"==typeof eA.status?{status:eA.status}:{}}}return"function_call_result"===eA.type?{type:"function_call_result",callId:normalizeCallId(eA.callId),name:eA.name,status:eA.status,output:sanitizeOutput(eA.output)}:eA}function followsReaso
```
