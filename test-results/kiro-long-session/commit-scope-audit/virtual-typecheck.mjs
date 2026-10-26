import ts from '../../../app/node_modules/typescript/lib/typescript.js';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const root=process.cwd().replaceAll('\\','/');
const git=(args,input)=>{const p=spawnSync('git',args,{input,maxBuffer:100*1024*1024});if(p.status!==0)throw Error(p.stderr.toString());return p.stdout;};
const ref=git(['rev-parse','origin/master']).toString().trim();
const entries=git(['ls-tree','-r',ref,'--','app']).toString().trim().split('\n').map(l=>{const [meta,file]=l.split('\t');return {oid:meta.split(' ')[2],file};}).filter(e=>/\.(?:ts|tsx|js|mjs|cjs|json|css)$/.test(e.file));
const raw=git(['cat-file','--batch'],entries.map(e=>e.oid).join('\n')+'\n');
const upstream=new Map();let offset=0;
for(const e of entries){const end=raw.indexOf(10,offset);const size=Number(raw.subarray(offset,end).toString().split(' ')[2]);upstream.set(root+'/'+e.file,raw.subarray(end+1,end+1+size).toString());offset=end+size+2;}
const six=['app/scripts/kiro-live-check.mjs','app/src/server/providers/kiro-chat-protocol.ts','app/src/server/providers/kiro-chat.ts','app/tests/kiro-chat.test.ts','app/tests/kiro-thinking.test.ts','docs/kiro-thinking.md'];
const closure=['kiro-catalog.ts','kiro-eventstream.ts','kiro-thinking.ts','kiro-thinking-stream.ts','kiro.ts'].map(f=>'app/src/server/providers/'+f).concat('app/tests/fixtures/kiro-eventstream.ts');
const secure=['app/src/server/providers/kiro-auth.ts','app/src/server/model-runtime.ts','app/tests/kiro-auth.test.ts'];
const outputs=[];
for(const [name,added] of [['upstream',[]],['six-files',six],['provider-closure',[...six,...closure]],['secure-provider',[...six,...closure,...secure]]]){
 if(process.argv[2] && process.argv[2]!==name)continue;
 const virtual=new Map(upstream);for(const file of added)virtual.set(root+'/'+file,readFileSync(file,'utf8'));
 const norm=f=>path.resolve(f).replaceAll('\\','/');
 const owned=f=>f.startsWith(root+'/app/')&&!f.includes('/node_modules/');
 const options=ts.convertCompilerOptionsFromJson(JSON.parse(virtual.get(root+'/app/tsconfig.json')).compilerOptions,root+'/app').options;
 options.configFilePath=root+'/app/tsconfig.json';
 const host=ts.createCompilerHost(options);host.getCurrentDirectory=()=>root+'/app';const origRead=host.readFile,origExists=host.fileExists;
 host.readFile=f=>{f=norm(f);return owned(f)?virtual.get(f):origRead(f);};
 host.fileExists=f=>{f=norm(f);return owned(f)?virtual.has(f):origExists(f);};
 host.getSourceFile=(f,lang)=>{const txt=host.readFile(f);return txt===undefined?undefined:ts.createSourceFile(f,txt,lang,true);};
 const roots=[...virtual.keys()].filter(f=>/\.(ts|tsx)$/.test(f)&&(/\/app\/(src|tests)\//.test(f)||f.endsWith('/app/vite.config.ts')));
 const program=ts.createProgram(roots,options,host);const diagnostics=ts.getPreEmitDiagnostics(program);
 const formatted=ts.formatDiagnostics(diagnostics,{getCanonicalFileName:f=>f,getCurrentDirectory:()=>root,getNewLine:()=> '\n'});
 const result={name,ref,added,roots:roots.length,diagnostics:diagnostics.length};outputs.push(result);console.log(JSON.stringify(result));
 writeFileSync('test-results/kiro-long-session/commit-scope-audit/'+name+'.log',formatted||'No TypeScript diagnostics.\n');
}
writeFileSync('test-results/kiro-long-session/commit-scope-audit/'+(process.argv[2]||'all')+'-results.json',JSON.stringify(outputs,null,2)+'\n');
