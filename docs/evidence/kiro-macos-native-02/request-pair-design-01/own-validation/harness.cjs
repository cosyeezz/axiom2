 'use strict';
const fs=require('node:fs');
const {compareRequestBodies:cmp}=require(process.argv[2]);
const names=['conversationState','profileArn','agentMode','additionalModelRequestFields','systemPrompt','conversationId','chatTriggerType','history','currentMessage','currentModelId','currentContent','currentOrigin','currentContext','currentTools'];
const base={conversationState:{conversationId:'CANARY-ID-A',chatTriggerType:'CANARY-TRIGGER',history:[{content:'CANARY-HISTORY'}],currentMessage:{userInputMessage:{modelId:'CANARY-MODEL',content:'CANARY-CONTENT',origin:'CANARY-ORIGIN',userInputMessageContext:{tools:[{name:'CANARY-TOOL'}]}}}},profileArn:'CANARY-PROFILE',agentMode:'CANARY-MODE',additionalModelRequestFields:{CANARY_UNKNOWN:'CANARY-VALUE'},systemPrompt:'CANARY-SYSTEM'};
const s=JSON.stringify(base);const clone=()=>JSON.parse(s);let touched=0;
const getter=Object.defineProperties({}, {toString:{get(){touched++;throw 1}},valueOf:{get(){touched++;throw 1}},[Symbol.toPrimitive]:{get(){touched++;throw 1}}});
const proxy=new Proxy({}, {get(){touched++;throw 1}});
const cases=[];
function add(id,l,r,ls,rs,u,mode='none',diff=[]){cases.push({id,l,r,ls,rs,u,mode,diff});}
add('identical-complete',s,s,'canonical-object','canonical-object','equal','full');
let x=clone();x.agentMode='CANARY-OTHER';add('known-field',s,JSON.stringify(x),'canonical-object','canonical-object','different','full',['agentMode']);
x=clone();x.additionalModelRequestFields.CANARY_UNKNOWN='CANARY-OTHER';add('unknown-field',s,JSON.stringify(x),'canonical-object','canonical-object','different','full',['additionalModelRequestFields']);
x=clone();x.conversationState.history[0].content='CANARY-OTHER';x.conversationState.currentMessage.userInputMessage.userInputMessageContext.tools[0].name='CANARY-OTHER';x.conversationState.currentMessage.userInputMessage.content='CANARY-OTHER';x.systemPrompt='CANARY-OTHER';x.profileArn='CANARY-OTHER';add('preserved-context',s,JSON.stringify(x),'canonical-object','canonical-object','different','full',['conversationState','history','currentMessage','currentContent','currentContext','currentTools','systemPrompt','profileArn']);
x=clone();x.conversationState.conversationId='CANARY-ID-B';add('dynamic-id',s,JSON.stringify(x),'canonical-object','canonical-object','different','full',['conversationState','conversationId']);
add('missing-fields','{}','{"profileArn":null}','canonical-object','canonical-object','different','missing');
add('duplicate','{"a":1,"a":2}','{"a":2}','noncanonical-json','canonical-object','different');
add('escaped-duplicate','{"a":1,"\\u0061":2}','{"a":2}','noncanonical-json','canonical-object','different');
add('whitespace','{ "a":1}','{"a":1}','noncanonical-json','canonical-object','different');
add('alternate-unicode','{"a":"\\u00e9"}','{"a":"é"}','noncanonical-json','canonical-object','different');
add('number-precision','{"a":9007199254740993}','{"a":9007199254740992}','noncanonical-json','canonical-object','different');
add('number-nonfinite','{"a":1e400}','{"a":NaN}','noncanonical-json','invalid-json','different');
add('root-types','[]','null','unsupported-root','unsupported-root','different');
const nested=n=>'['.repeat(n-1)+'0'+']'.repeat(n-1);add('depth-32','{"a":'+nested(32)+'}','{"a":'+nested(32)+'}','canonical-object','canonical-object','equal');
add('depth-33','{"a":'+nested(33)+'}','{}','depth-cap','canonical-object','different');
const quoted=JSON.stringify({a:'[[{{"\\'+']}'.repeat(40)});add('quoted-brackets',quoted,quoted,'canonical-object','canonical-object','equal');
const cap=262144;const ascii='{"a":"'+'a'.repeat(cap-8)+'"}';add('ascii-at-cap',ascii,ascii,'canonical-object','canonical-object','equal');
add('ascii-over-cap',ascii+' ',ascii,'byte-cap','canonical-object','unknown');
const uni='{"a":"'+'é'.repeat((cap-8)/2)+'"}';add('utf8-at-cap',uni,uni,'canonical-object','canonical-object','equal');
const over=uni.replace('"}', 'é"}');add('utf8-over-cap',over,uni,'byte-cap','canonical-object','unknown');
add('nonprimitive-getters',getter,new String('{}'),'unsupported-type','unsupported-type','unknown');
add('nonprimitive-proxy',proxy,Symbol('CANARY-SYMBOL'),'unsupported-type','unsupported-type','unknown');
add('invalid-json','{"a":','{}','invalid-json','canonical-object','different');
add('number-spelling','{"a":1.0}','{"a":1}','noncanonical-json','canonical-object','different');
const manifest=cases.map(c=>({id:c.id,leftState:c.ls,rightState:c.rs,utf8:c.u,fields:c.mode,differentFields:c.diff}));
fs.writeFileSync(process.argv[3]+'/manifest.json',JSON.stringify({caseCount:cases.length,cases:manifest},null,2),{flag:'wx',mode:0o600});
// Manifest complete before first invocation. No input strings or exceptions are persisted.
const outer=['schema','boundary','utf8','leftStructuredState','rightStructuredState','fields','originalInputsRewritten','dynamicDifferencesNormalized','unknownFieldsCoveredByWholeUtf8Comparison','completeRequestEqualityProved','authenticationParityProved','wireReceiptProved'];
const uk=['schema','check','result','reason','inputCodeUnitsEqual','boundary','requestCompletenessProved','wireReceiptProved'];
function keys(o,k){return o&&typeof o==='object'&&JSON.stringify(Object.keys(o).sort())===JSON.stringify([...k].sort());}
const reports=[];let all=true;
for(const c of cases){let ok=true;try{const o=cmp(c.l,c.r);ok=keys(o,outer)&&o.schema==='provided-body-pair-1'&&o.boundary==='supplied-values-only'&&o.leftStructuredState===c.ls&&o.rightStructuredState===c.rs&&keys(o.utf8,uk)&&o.utf8.schema==='real-http-value-check-1'&&o.utf8.check==='provided-utf8-payloads'&&o.utf8.boundary==='provided-values-only'&&o.utf8.result===c.u;
const reason=c.u==='unknown'?(c.ls==='unsupported-type'?'unsupported-input-type':'byte-cap'):'complete-provided-values';ok=ok&&o.utf8.reason===reason&&o.utf8.inputCodeUnitsEqual===(c.u==='unknown'?null:c.l===c.r)&&o.utf8.requestCompletenessProved===false&&o.utf8.wireReceiptProved===false;
for(const p of ['originalInputsRewritten','dynamicDifferencesNormalized','completeRequestEqualityProved','authenticationParityProved','wireReceiptProved'])ok=ok&&o[p]===false;
ok=ok&&o.unknownFieldsCoveredByWholeUtf8Comparison===true&&keys(o.fields,names);
for(const n of names){const v=o.fields[n];ok=ok&&keys(v,['leftPresent','rightPresent','valuesEqual']);if(c.ls!=='canonical-object'||c.rs!=='canonical-object'){ok=ok&&v.leftPresent===null&&v.rightPresent===null&&v.valuesEqual===null;}else if(c.mode==='full'){ok=ok&&v.leftPresent===true&&v.rightPresent===true&&v.valuesEqual===!c.diff.includes(n);}else if(c.mode==='missing'){ok=ok&&v.leftPresent===false&&v.rightPresent===(n==='profileArn')&&v.valuesEqual===null;}else{ok=ok&&v.leftPresent===false&&v.rightPresent===false&&v.valuesEqual===null;}}
const encoded=JSON.stringify(o);ok=ok&&!encoded.includes('CANARY')&&!encoded.includes('900719925474099')&&!/[a-f0-9]{64}/.test(encoded);
}catch(_){ok=false;} reports.push({id:c.id,passed:!!ok});all=all&&ok;}
all=all&&touched===0&&cases.length===24&&JSON.stringify(base)===s;
fs.writeFileSync(process.argv[3]+'/safe-report.json',JSON.stringify({caseCount:cases.length,passed:reports.filter(x=>x.passed).length,gettersInvoked:touched,originalFixtureUnchanged:JSON.stringify(base)===s,allPassed:all,cases:reports},null,2),{flag:'wx',mode:0o600});process.exitCode=all?0:1;
