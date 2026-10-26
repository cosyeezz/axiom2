## zVe
{"name":"zVe","file":"zVe.js","source":"F:\\Axiom\\axiom2\\review-artifacts\\qoder-audit-20260817\\official\\package\\bundle\\qodercli.js","sourceSha256":"ec7b2a2c1be206f525ca974c3b9455fbec9ce7411bc5dfdee55f1e82eb90df38","startUtf16":23634382,"endUtf16":23636859,"startByte":23645320,"lengthBytes":2477,"line":258,"sha256":"05e013681aafcd3316e5c9154b7b7f579955b554d34d19960d4db2714a66d150"}

```js
function zVe(A,e,t,i,r,n,o){if(0===r.trim().length)throw new GF(_$d1("Ky4MPyYQTyVYVFYDWTkEIScQHDxEEEEKCD4IIjdVDmhZX11CHCYRJCtVHC1EQ1oAFwIFfg=="));let s=o?.requestId??h_l(),{resolvedModelKey:a,modelConfig:l,customModel:g,isReasoning:c,defaultMaxOutputTokens:B,functionSwitches:u}=w_l(t,i,o?.customModelOverride,o?.modelResolution),d=dwA(e,o?.skipCacheWrite,{supportsVision:l.is_vl});!1===o?.generation?.reasoning?.preserve&&(d=d.map(A=>{let{[bK]:e,reasoning_content:t,reasoning_content_signature:i,reasoning_item:r,...n}=A,o=e?.filter(A=>"thinking"!==A.type&&"redacted_thinking"!==A.type);return o?.length&&Object.defineProperty(n,bK,{value:o,enumerable:!1}),n}));let Q=A?.filter(A=>A.text.length>0)??[],E=X2e()?Q:MK(Q);Q.length>0&&d.unshift({role:"system",content:E});let I=Ufe(t,i,o?.modelResolution),w=Array.isArray(I?.efforts)||!0===I?.supports_disabled,h=void 0!==I?.outer_provider,C=hrt(o?.generation);void 0!==o?.maxOutputTokens?C.max_tokens=qT(o.maxOutputTokens):void 0===C.max_tokens&&(C.max_tokens=qT(B));let p=Mi(I?.default_effort),f=o?.reasoningEffort??(c?AAe(o?.thinkingBudget):void 0)??(void 0===C.reasoning_effort&&!1!==C.enable_thinking?p:void 0);if(f&&(!h&&!w||mde(I,f))){let A=C.reasoning_effort;C.reasoning_effort=f,"none"===f?(C.enable_thinking=!1,delete C.reasoning_budget_tokens):(C.enable_thinking=!0,void 0!==o?.thinkingBudget&&o.thinkingBudget>0?C.reasoning_budget_tokens=o.thinkingBudget:A!==f&&delete C.reasoning_budget_tokens)}(0===o?.thinkingBudget||"none"===C.reasoning_effort||!1===C.enable_thinking)&&(l.is_reasoning=!1),void 0!==o?.contextWindow&&mAe(I,o.contextWindow)&&(C.context_length=o.contextWindow),void 0!==o?.toolChoice&&(C.tool_choice=o.toolChoice);let m=ist(u,o?.functionSwitchSelections),D=C_l(o?.business,m),S=y_l(D_l(d),a,l.is_reasoning);return{defaultReasoningEffort:p,request_id:s,request_set_id:o?.requestSetId??s,chat_record_id:s,...void 0!==o?.customContext?{custom_context:o.customContext}:{},session_id:r,...void 0!==o?.sourceSessionId?{source_session_id:o.sourceSessionId}:{},stream:!0,chat_task:"FREE_INPUT",chat_context:S,is_reply:!0,is_retry:!1,source:1,version:"3",agent_id:"agent_common",...o?.omitTaskId?{}:{task_id:o?.taskId??Q_l(D?.type)??o?.policyTaskId??"common"},session_type:process.env[UOe]??(eg()?WCe:eHe),aliyun_user_type:"",model_config:l,custom_model:g,system:E,messages:d,tools:o?.tools??[],parameters:C,...o?.patches&&Object.keys(o.patches).length>0?{patches:o.patches}:{},...void 0!==D?{business:D}:{}}}
```

## w_l
{"name":"w_l","file":"w-l.js","source":"F:\\Axiom\\axiom2\\review-artifacts\\qoder-audit-20260817\\official\\package\\bundle\\qodercli.js","sourceSha256":"ec7b2a2c1be206f525ca974c3b9455fbec9ce7411bc5dfdee55f1e82eb90df38","startUtf16":23636941,"endUtf16":23638129,"startByte":23647879,"lengthBytes":1188,"line":258,"sha256":"e0c0205425dc05c1e64e27c93fa45db0c3ae941671b838dc53e561087cb4d03e"}

```js
function w_l(A,e,t,i){let r,n=Ufe(A,e,i),o=n?.key??A,s=n?.is_reasoning??!1,a=n?.display_name??o,l=n?.source??Wxe,g=n?.max_input_tokens??2e5,c=qT(n?.max_output_tokens),B=n?.format??"openai",u=void 0!==t||l===bhA&&!(n?.server_scene===Db),d=u?Wxe:l,Q={key:u?I_l:o,display_name:a,...n?.outer_provider?{outer_provider:n.outer_provider}:{model:""},format:B,is_vl:t?.isVl??n?.is_vl??!1,is_reasoning:s,api_key:"",url:"",source:d,max_input_tokens:g,...n?.custom_provider_adapter?{custom_provider_adapter:n.custom_provider_adapter}:{}};if(t){let e=Rfo(t.provider),i=Tfo(e,t.type??n?.type),o=Pfo(t.provider,t.style??n?.custom_model_style),s=kfo(t.provider,t.url);r={...e?{provider:e}:{},model:A,...i?{type:i}:{},parameters:{...n?.byok_parameters??{},api_key:t.api_key},...void 0!==s?{url:s}:{},...o?{style:o}:{}}}else if(u&&n){let A=Rfo(n.provider),e=Tfo(A,n.type),t=Pfo(n.provider,n.custom_model_style),i=kfo(n.provider,n.url??"");r={...A?{provider:A}:{},model:S_l(n)??"",...e?{type:e}:{},parameters:n.byok_parameters??{},...void 0!==i?{url:i}:{},...t?{style:t}:{}}}return{resolvedModelKey:o,modelConfig:Q,customModel:r,isReasoning:s,defaultMaxOutputTokens:c,functionSwitches:n?.function_switches}}
```

## mAe
{"name":"mAe","file":"mAe.js","source":"F:\\Axiom\\axiom2\\review-artifacts\\qoder-audit-20260817\\official\\package\\bundle\\qodercli.js","sourceSha256":"ec7b2a2c1be206f525ca974c3b9455fbec9ce7411bc5dfdee55f1e82eb90df38","startUtf16":19867506,"endUtf16":19867673,"startByte":19877774,"lengthBytes":167,"line":81,"sha256":"279a63b1aea841f5e02f5c892a604290e1767b413a20984a97adc30279861beb"}

```js
function mAe(A,e){let t=khA(e);if(void 0===t)return!1;let i=_Wi(A);if(i)return i.includes(t);let r=khA(A?.max_input_tokens??A?.maxInputTokens);return void 0===r||t<=r}
```

## EAe
{"name":"EAe","file":"EAe.js","source":"F:\\Axiom\\axiom2\\review-artifacts\\qoder-audit-20260817\\official\\package\\bundle\\qodercli.js","sourceSha256":"ec7b2a2c1be206f525ca974c3b9455fbec9ce7411bc5dfdee55f1e82eb90df38","startUtf16":19867122,"endUtf16":19867334,"startByte":19877390,"lengthBytes":212,"line":81,"sha256":"d58e552afd935563c145184b612233876857c293adef68b93d0d25f83bc466d0"}

```js
function EAe(A){if(!A)return[];let e=_Wi(A);if(e)return e;let t=khA(A.max_input_tokens??A.maxInputTokens);if(void 0===t)return[];let i=[],r=A=>{A>0&&A<=t&&!i.includes(A)&&i.push(A)};return r(128e3),r(2e5),r(t),i}
```

## _Wi
{"name":"_Wi","file":"-Wi.js","source":"F:\\Axiom\\axiom2\\review-artifacts\\qoder-audit-20260817\\official\\package\\bundle\\qodercli.js","sourceSha256":"ec7b2a2c1be206f525ca974c3b9455fbec9ce7411bc5dfdee55f1e82eb90df38","startUtf16":19866536,"endUtf16":19866623,"startByte":19876804,"lengthBytes":87,"line":81,"sha256":"8603ad9e5c09943f4ce4a60de2c904b1e940dfdae0a98ee3a9f1b0a63eb571ee"}

```js
function _Wi(A){if(A)return v1(A.available_context_windows??A.availableContextWindows)}
```

## qU
{"name":"qU","file":"qU.js","source":"F:\\Axiom\\axiom2\\review-artifacts\\qoder-audit-20260817\\official\\package\\bundle\\qodercli.js","sourceSha256":"ec7b2a2c1be206f525ca974c3b9455fbec9ce7411bc5dfdee55f1e82eb90df38","startUtf16":28805753,"endUtf16":28805846,"startByte":28837781,"lengthBytes":93,"line":422,"sha256":"4a529489507bb9b7d4bf38af52932d1182d88a7b0c70db5c16327a466135417f"}

```js
function qU(A){let e=Ggd(A);return void 0!==e?e:tL()?jgd(A)?lM(A)[0]:Ygd(A)??lM(A)[0]:void 0}
```

## _L
{"name":"_L","file":"-L.js","source":"F:\\Axiom\\axiom2\\review-artifacts\\qoder-audit-20260817\\official\\package\\bundle\\qodercli.js","sourceSha256":"ec7b2a2c1be206f525ca974c3b9455fbec9ce7411bc5dfdee55f1e82eb90df38","startUtf16":19467166,"endUtf16":19467302,"startByte":19477432,"lengthBytes":136,"line":81,"sha256":"1cb657c74c16fa57f12d503a7b3477a8405f62428d3242ad480c959d90e980c0"}

```js
function _L(A){let e=Okn(A.efforts??[])??[];return!0!==A.supports_disabled&&!0!==A.supportsDisabled||e.includes("none")?e:[...e,"none"]}
```

## UOa
{"name":"UOa","file":"UOa.js","source":"F:\\Axiom\\axiom2\\review-artifacts\\qoder-audit-20260817\\official\\package\\bundle\\qodercli.js","sourceSha256":"ec7b2a2c1be206f525ca974c3b9455fbec9ce7411bc5dfdee55f1e82eb90df38","startUtf16":34402351,"endUtf16":34402661,"startByte":34475793,"lengthBytes":310,"line":857,"sha256":"5dc0b4a1b3803a892b8cd8e710e059476beb9480653956f22abf4dfa36646f5a"}

```js
function UOa(A){let e=A.model.capabilities.vision;return A.messages.map(A=>{switch(A.role){case"system":return{role:"system",content:HTg(A.content)};case"user":return{role:"user",...FOa(A.content,e)};case"tool":return{role:"tool",...FOa(A.content,e),tool_call_id:A.toolCallId};case"assistant":return jTg(A)}})}
```

## MOa
{"name":"MOa","file":"MOa.js","source":"F:\\Axiom\\axiom2\\review-artifacts\\qoder-audit-20260817\\official\\package\\bundle\\qodercli.js","sourceSha256":"ec7b2a2c1be206f525ca974c3b9455fbec9ce7411bc5dfdee55f1e82eb90df38","startUtf16":34402095,"endUtf16":34402333,"startByte":34475537,"lengthBytes":238,"line":857,"sha256":"2f551fe4c67d17ce19715fab3682d9c487c32cbc22a235f046726436fa161a55"}

```js
function MOa(A){let e=OTg(A)??"";return{text:e,features:[],extra:{context:[],modelConfig:{key:A.model.key,is_reasoning:A.model.capabilities.reasoning.supported&&"none"!==A.reasoningEffort},originalContent:e},chatPrompt:"",imageUrls:null}}
```

## jOa
{"name":"jOa","file":"jOa.js","source":"F:\\Axiom\\axiom2\\review-artifacts\\qoder-audit-20260817\\official\\package\\bundle\\qodercli.js","sourceSha256":"ec7b2a2c1be206f525ca974c3b9455fbec9ce7411bc5dfdee55f1e82eb90df38","startUtf16":34405462,"endUtf16":34405727,"startByte":34478926,"lengthBytes":265,"line":857,"sha256":"19c38a5f42c3a937bace7537a82083f7608c5cfbb5037b6f28adc3abac6cec2c"}

```js
function jOa(A){let e=A.model;return{key:ROa(A),display_name:e.displayName,is_vl:e.capabilities.vision,is_reasoning:e.capabilities.reasoning.supported&&"none"!==A.reasoningEffort,max_input_tokens:e.limits.maxContextTokens,format:"",api_key:"",url:"",source:TOa(A)}}
```

## MTg
{"name":"MTg","file":"MTg.js","source":"F:\\Axiom\\axiom2\\review-artifacts\\qoder-audit-20260817\\official\\package\\bundle\\qodercli.js","sourceSha256":"ec7b2a2c1be206f525ca974c3b9455fbec9ce7411bc5dfdee55f1e82eb90df38","startUtf16":34394895,"endUtf16":34395404,"startByte":34468337,"lengthBytes":509,"line":857,"sha256":"1a5e351c16de6feb1449ceda0a0bdf8de856ba873dcd1b84fef1329985b3d5e1"}

```js
function MTg(A){if(!A||"object"!=typeof A)return;let e=new Set,t=[];for(let[i,r]of Object.entries(A)){let A=w_(r),n=A?.token_count;"number"!=typeof n||!Number.isInteger(n)||n<=0||e.has(n)||(e.add(n),t.push({tokens:n,isDefault:!0===X8r(A?.is_default),..."string"==typeof i&&i.trim()?{label:i}:{}}))}if(0===t.length)return;t.sort((A,e)=>A.tokens-e.tokens);let i=t.find(A=>A.isDefault)?.tokens;return{tiers:t.map(({tokens:A,label:e})=>({tokens:A,...void 0!==e?{label:e}:{}})),...void 0!==i?{defaultWindow:i}:{}}}
```
