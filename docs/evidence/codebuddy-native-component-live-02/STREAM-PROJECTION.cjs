'use strict';
const MODEL='deepseek-v4.1-flash',TOOL='read_component_fixture',MARKER='AXIOM_CODEBUDDY_COMPONENT_02_8c74a91e';
const shape=value=>value===undefined?'missing':value===null?'null':value===''?'empty-string':Array.isArray(value)?'array':['string','object','number','boolean'].includes(typeof value)?typeof value:'other';
const legacy=value=>({shape:shape(value),nameShape:shape(value?.name),argumentsShape:shape(value?.arguments),unknownKeys:!!value&&typeof value==='object'&&Object.keys(value).some(key=>!['name','arguments'].includes(key))});
module.exports=function project(bytes,exit){
 const result={bytes:bytes.length,exit,frames:[],done:false,doneCount:0};let answer='';
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes,{stream:exit!=='eof'});
 for(const record of text.replace(/\r\n?/g,'\n').split('\n\n')){
  const data=record.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(!data)continue;
  if(data==='[DONE]'){result.done=true;result.doneCount++;continue;}
  if(result.frames.length>=100){result.frameLimit=true;break;}
  let event;try{event=JSON.parse(data);}catch{result.frames.push({invalidJson:true});continue;}
  const frame={modelDeclared:typeof event?.model==='string',modelMatches:event?.model===MODEL,errorPresent:!!event?.error};
  if(Array.isArray(event?.choices))frame.choices=event.choices.slice(0,2).map(choice=>{
   const delta=choice?.delta;if(typeof delta?.content==='string')answer+=delta.content;
   const out={index:Number.isSafeInteger(choice?.index)?choice.index:null,finishShape:shape(choice?.finish_reason),finish:['stop','tool_calls','length','content_filter','function_call'].includes(choice?.finish_reason)?choice.finish_reason:null,
    roleShape:shape(delta?.role),roleAssistant:delta?.role==='assistant',contentLength:typeof delta?.content==='string'?delta.content.length:0,reasoningShape:shape(delta?.reasoning_content),refusalShape:shape(delta?.refusal),legacy:legacy(delta?.function_call),toolsShape:shape(delta?.tool_calls)};
   if(Array.isArray(delta?.tool_calls))out.tools=delta.tool_calls.slice(0,2).map(call=>({index:Number.isSafeInteger(call?.index)?call.index:null,idShape:shape(call?.id),typeShape:shape(call?.type),typeFunction:call?.type==='function',functionShape:shape(call?.function),nameShape:shape(call?.function?.name),nameMatches:call?.function?.name===TOOL,argumentsShape:shape(call?.function?.arguments),argumentsLength:typeof call?.function?.arguments==='string'?call.function.arguments.length:0,unknownFunctionKeys:!!call?.function&&typeof call.function==='object'&&Object.keys(call.function).some(key=>!['name','arguments'].includes(key))}));
   return out;
  });
  if(event?.usage&&typeof event.usage==='object')frame.usage=Object.fromEntries(['prompt_tokens','completion_tokens','total_tokens','cached_tokens'].filter(key=>Number.isSafeInteger(event.usage[key])&&event.usage[key]>=0).map(key=>[key,event.usage[key]]));
  result.frames.push(frame);
 }
 result.textLength=answer.length;result.markerExact=answer.trim()===MARKER;result.nextMarkerExact=answer.trim()===MARKER+'_NEXT';return result;
};
