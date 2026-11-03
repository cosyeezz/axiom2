import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,join,resolve,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {syncBuiltinESMExports} from 'node:module';
import http from 'node:http';import https from 'node:https';import net from 'node:net';import child from 'node:child_process';
const dir=dirname(fileURLToPath(import.meta.url)),root=resolve(dir,'../../..'),skill=join(root,'.agents/skills/cli-native-provider');
const hash=path=>createHash('sha256').update(fs.readFileSync(path)).digest('hex');
const walk=path=>fs.readdirSync(path,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(path,e.name)):[join(path,e.name)]);
async function verify(){
 const files=[...walk(skill),'docs/codebuddy-native-component.md','docs/codebuddy-native-parity.md','docs/evidence/codebuddy-native-component-01/PROTOCOL-MATRIX.md',...['02','03'].map(n=>`docs/evidence/codebuddy-native-fix-${n}/REPORT.md`),...['02','03'].map(n=>`docs/evidence/codebuddy-native-component-live-${n}/REPORT.md`)].map(p=>resolve(root,p));let links=0;
 for(const path of files){const text=fs.readFileSync(path,'utf8');assert(text.endsWith('\n'));assert.doesNotMatch(text,/[\t ]+$/m);assert.equal((text.match(/^```/gm)??[]).length%2,0);for(const [,href]of text.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)){if(/^(https?:|#)/.test(href))continue;assert(fs.existsSync(resolve(dirname(path),decodeURIComponent(href.split('#')[0]))),`broken local link: ${relative(root,path)} -> ${href}`);links++;}}
 const live=join(root,'docs/evidence/codebuddy-native-component-live-03'),manifest=JSON.parse(fs.readFileSync(join(live,'FROZEN-RUNTIME.json')));
 for(const file of manifest.sources)assert.equal(hash(join(root,file.path)),file.sha256);
 const emit=manifest.files.filter(f=>f.path.startsWith('app/dist/native-providers/codebuddy/')||['app/dist/native-providers/index.js','app/dist/native-providers/index.js.map'].includes(f.path));assert.equal(emit.length,26);for(const f of emit)assert.equal(hash(join(root,f.path)),f.sha256);
 const proof=JSON.parse(fs.readFileSync(join(live,'verification.json')));assert.equal(proof.passed,true);for(const file of proof.evidence)assert.equal(hash(join(live,file.path)),file.sha256);
 let denied=0;const deny=()=>{denied++;throw Error('NETWORK_OR_CHILD_DENIED');};const original={fetch:globalThis.fetch,connect:net.Socket.prototype.connect};const patches=[];for(const [object,names]of [[http,['get','request']],[https,['get','request']],[child,['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']]])for(const name of names){patches.push([object,name,object[name]]);object[name]=deny;}
 globalThis.fetch=deny;net.Socket.prototype.connect=deny;syncBuiltinESMExports();const temp=fs.mkdtempSync(join(tmpdir(),'codebuddy-final-skill-'));const env={HOME:process.env.HOME,PI_CODING_AGENT_DIR:process.env.PI_CODING_AGENT_DIR};process.env.HOME=temp;process.env.PI_CODING_AGENT_DIR=temp;
 let diagnostics;
 try{const {loadSkillsFromDir,formatSkillsForPrompt}=await import(pathToFileURL(join(root,'app/node_modules/@earendil-works/pi-coding-agent/dist/index.js')).href);const loaded=loadSkillsFromDir({dir:skill,source:'path'});assert.deepEqual(loaded.diagnostics,[]);assert.equal(loaded.skills.length,1);assert.equal(loaded.skills[0].name,'cli-native-provider');assert(formatSkillsForPrompt(loaded.skills).includes(loaded.skills[0].filePath));const tree=loadSkillsFromDir({dir:dirname(skill),source:'path'});assert.deepEqual(tree.diagnostics,[]);assert.equal(tree.skills.filter(s=>s.name==='cli-native-provider').length,1);diagnostics=loaded.diagnostics;assert.equal(denied,0);}
 finally{globalThis.fetch=original.fetch;net.Socket.prototype.connect=original.connect;for(const [object,name,value]of patches)object[name]=value;syncBuiltinESMExports();for(const [key,value]of Object.entries(env))if(value===undefined)delete process.env[key];else process.env[key]=value;fs.rmSync(temp,{recursive:true,force:true});}
 const result={passed:true,markdownFiles:files.length,localLinks:links,sourceMatches:manifest.sources.length,emitMatches:emit.length,liveEvidenceMatches:proof.evidence.length,skillDiagnostics:diagnostics,networkOrChildCalls:denied,scope:'documentation links, installed skill parser, current CodeBuddy source/emit versus successful SDK03; no new build/tests/live/deployment',files:files.map(path=>({path:relative(root,path),sha256:hash(path)}))};fs.writeFileSync(join(dir,'verification.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});return {passed:true,markdownFiles:files.length,localLinks:links,emitMatches:emit.length,networkOrChildCalls:denied};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)verify().then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e instanceof assert.AssertionError?e.message:'FINAL_VERIFICATION_FAILED');process.exitCode=1;});
