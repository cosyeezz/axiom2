const fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto');
const parser=require('/Users/dane/Library/Application Support/Axiom2/integrations/rea/versions/v6.8.0-ac139c98-44d0-4e8f-9ae4-5be44c6bdb18/node_modules/@babel/parser');
const input='/Applications/Kiro.app/Contents/Resources/app/extensions/kiro.kiro-agent/dist/extension.js';
const bytes=fs.readFileSync(input), source=bytes.toString('utf8');
const ast=parser.parse(source,{sourceType:'unambiguous',attachComment:false});
const needles=['serviceTarget:"KiroRuntimeService"','class extends ame','ame=class','Lht=class','function mMi(','pAi=class','function ohi(','function Uge(','convertToGenerateAssistantMessages','Bge=class','function C5o(','function $C(','function OAt(','function sfu(','function afu(','function Ovl('];
function children(node){return Object.values(node).flatMap(v=>Array.isArray(v)?v:[v]).filter(v=>v&&typeof v==='object'&&typeof v.type==='string'&&Number.isInteger(v.start));}
const dir='/tmp/kiro-client-rea-20261027/module-slices';fs.mkdirSync(dir,{recursive:true});
const selected=new Map(), traces=[];
for(const needle of needles){let offset=source.indexOf(needle);if(offset<0){traces.push({needle,missing:true});continue;}
 const chain=[];let node=ast;
 while(node){chain.push(node);node=children(node).find(c=>c.start<=offset&&c.end>offset);}
 const meaningful=chain.filter(n=>['AssignmentExpression','VariableDeclarator','ClassDeclaration','FunctionDeclaration'].includes(n.type));
 traces.push({needle,offset,chain:meaningful.map(n=>({type:n.type,start:n.start,end:n.end,name:n.id?.name??n.left?.name,bytes:n.end-n.start}))});
 const candidate=meaningful.find(n=>(n.end-n.start)<250000);
 if(candidate)selected.set(candidate.start,candidate);
}
const manifest=[];for(const n of selected.values()){
 const name=n.id?.name??n.left?.name??`offset-${n.start}`;
 const exact=source.slice(n.start,n.end), prefix=n.type==='VariableDeclarator'?'var ':'';
 const file=path.join(dir,name+'.js');const output=prefix+exact+';\n';fs.writeFileSync(file,output);
 manifest.push({file:path.basename(file),name,type:n.type,source:input,source_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),utf16_start:n.start,utf16_end:n.end,byte_start:Buffer.byteLength(source.slice(0,n.start)),byte_end:Buffer.byteLength(source.slice(0,n.end)),line_start:source.slice(0,n.start).split('\n').length,exact_slice_sha256:crypto.createHash('sha256').update(exact).digest('hex'),synthetic_prefix:prefix,synthetic_suffix:';\n',output_sha256:crypto.createHash('sha256').update(output).digest('hex')});
}
fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2));fs.writeFileSync(path.join(dir,'traces.json'),JSON.stringify(traces,null,2));console.log(JSON.stringify({traces,manifest},null,2));
