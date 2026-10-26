// Offline static extraction only: never imports or evaluates Qoder code.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('../../app/node_modules/typescript/lib/typescript.js');
const root=__dirname;
const input=path.join(root,'official/package/bundle/qodercli.js');
const source=fs.readFileSync(input,'utf8');
const sha256=s=>crypto.createHash('sha256').update(s).digest('hex');
const names=['zVe','w_l','mAe','EAe','_Wi','qU','_L','UOa','MOa','jOa','MTg'];
const records=[];
fs.mkdirSync(path.join(root,'focused'),{recursive:true});
for(const name of names){
 const index=source.indexOf('function '+name+'(');
 if(index<0){ records.push({name,error:'not found'});continue; }
 const candidate=source.slice(index,index+100000);
 const ast=ts.createSourceFile(name+'.js',candidate,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const fn=ast.statements[0];
 if(!ts.isFunctionDeclaration(fn)||fn.name?.text!==name||!fn.body) throw new Error('unexpected function '+name);
 const end=index+fn.end;
 const exact=source.slice(index,end);
 const byteOffset=Buffer.byteLength(source.slice(0,index));
 const line=source.slice(0,index).split('\n').length;
 const file=name.replaceAll('_','-')+'.js';
 fs.writeFileSync(path.join(root,'focused',file),exact+'\n');
 records.push({name,file,source:input,sourceSha256:sha256(source),startUtf16:index,endUtf16:end,startByte:byteOffset,lengthBytes:Buffer.byteLength(exact),line,sha256:sha256(exact)});
}
fs.writeFileSync(path.join(root,'focused/provenance.json'),JSON.stringify(records,null,2));
fs.writeFileSync(path.join(root,'official-excerpts.md'),records.map(r=>`## ${r.name}\n${JSON.stringify(r)}\n\n\`\`\`js\n${r.error?'':fs.readFileSync(path.join(root,'focused',r.file),'utf8')}\`\`\`\n`).join('\n'));
console.log(records);
