// Static extraction only; no package execution. Preserve original source ranges.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ts=require('../../app/node_modules/typescript/lib/typescript.js');
const input=path.resolve(__dirname,'../qoder-audit-20260817/official/package/bundle/qodercli.js');
const source=fs.readFileSync(input,'utf8'),hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const out=path.join(__dirname,'focused');fs.mkdirSync(out,{recursive:true});
const records=[];
for(const name of process.argv.slice(2)){
 const start=source.indexOf('function '+name+'(');if(start<0){console.error('Not found: '+name);process.exitCode=1;continue;}
 const ast=ts.createSourceFile(name+'.js',source.slice(start,start+200000),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),fn=ast.statements[0];
 if(!ts.isFunctionDeclaration(fn)||fn.name?.text!==name||!fn.body)throw Error('Unexpected declaration '+name);
 const end=start+fn.end,text=source.slice(start,end),file=name.replaceAll('_','-')+'.js';
 fs.writeFileSync(path.join(out,file),text+'\n');records.push({name,file,source:input,sourceSha256:hash(source),startUtf16:start,endUtf16:end,startByte:Buffer.byteLength(source.slice(0,start)),line:source.slice(0,start).split('\n').length,sha256:hash(text)});
}
const manifest=path.join(out,'provenance.json'),old=fs.existsSync(manifest)?JSON.parse(fs.readFileSync(manifest,'utf8')):[];
fs.writeFileSync(manifest,JSON.stringify([...old.filter(r=>!records.some(n=>n.name===r.name)),...records],null,2));
console.log(JSON.stringify(records));
