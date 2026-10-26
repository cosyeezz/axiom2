import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
const root='F:/Axiom/axiom2/docs/evidence/kiro-long-session';
const forbidden=new Set(['workspaceId','parentSessionId','sessionId','taskId','inputId','prompt','answer','thinkingText','signature','toolArguments','toolResults','nativeSessionId','transcriptBasename','thinking']);
const found=[];
for(const file of readdirSync(root).filter(n=>n.endsWith('.json'))){
 const walk=(o,path='')=>{if(!o||typeof o!=='object')return;for(const[k,v]of Object.entries(o)){if(forbidden.has(k))found.push({file,path:path+'.'+k,type:Array.isArray(v)?'array':typeof v,...(typeof v==='number'?{nonnegativeSafeInteger:Number.isSafeInteger(v)&&v>=0}:{})});if(v&&typeof v==='object')walk(v,path+'.'+k);}};
 walk(JSON.parse(readFileSync(resolve(root,file),'utf8')));
}
console.log(JSON.stringify(found,null,2));
