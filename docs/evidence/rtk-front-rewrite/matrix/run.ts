import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { bindRtkRewrite, rtkRewriteEligibility } from '/Volumes/D_Work/axiom2/app/src/server/integrations/rtk-rewrite.ts';
const base='/tmp/axiom-rtk-official-implementation-hardened';
const configPath='/Users/dane/Library/Application Support/Axiom2/integrations/rtk/config.json';
const config=JSON.parse(readFileSync(configPath,'utf8'));
const binary=join('/Users/dane/Library/Application Support/Axiom2/integrations/rtk/versions',config.installation.directory,'rtk');
const root=join(base,'root'), fixture=join(base,'fixture'), nongit=join(base,'nongit');
for(const d of [root,fixture,nongit,join(base,'logs'),join(root,'integrations/rtk'),join(base,'home'),join(base,'xdg-config'),join(base,'xdg-data'),join(base,'xdg-cache')]) mkdirSync(d,{recursive:true});
const env={...process.env,HOME:join(base,'home'),XDG_CONFIG_HOME:join(base,'xdg-config'),XDG_DATA_HOME:join(base,'xdg-data'),XDG_CACHE_HOME:join(base,'xdg-cache'),NO_COLOR:'1',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_PAGER:'cat',PAGER:'cat',RTK_TELEMETRY_DISABLED:'1',DO_NOT_TRACK:'1',RTK_RECALL:'0',RTK_TEE:'0',RTK_DB_PATH:join(root,'integrations/rtk/upstream.db'),RTK_RECALL_DB:join(root,'integrations/rtk/upstream-recall.db')};
function run(file:string,args:string[],cwd=fixture){const r=spawnSync(file,args,{cwd,env,encoding:'utf8',timeout:15000,maxBuffer:4*1024*1024});return {code:r.status,signal:r.signal,error:r.error?.message,stdout:r.stdout??'',stderr:r.stderr??''};}
function setup(args:string[]){const r=run('/usr/bin/git',args);if(r.code!==0)throw Error(JSON.stringify(r));}
setup(['init','-q']);setup(['config','user.name','Fixture']);setup(['config','user.email','fixture@example.invalid']);
writeFileSync(join(fixture,'tracked.txt'),'alpha needle\nbeta\ngamma\n');mkdirSync(join(fixture,'sub'),{recursive:true});writeFileSync(join(fixture,'sub/other.txt'),'needle in sub\n');setup(['add','.']);setup(['commit','-qm','fixture initial']);
writeFileSync(join(fixture,'tracked.txt'),'alpha needle\nbeta changed\ngamma\nadded needle\n');writeFileSync(join(fixture,'untracked.txt'),'another needle\n');
const version=run(binary,['--version']);
writeFileSync(join(base,'metadata.json'),JSON.stringify({configPath,binary,version,env:Object.fromEntries(['HOME','XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_CACHE_HOME','NO_COLOR','LC_ALL','GIT_CONFIG_NOSYSTEM','GIT_CONFIG_GLOBAL','GIT_PAGER','PAGER','RTK_TELEMETRY_DISABLED','DO_NOT_TRACK','RTK_RECALL','RTK_TEE','RTK_DB_PATH','RTK_RECALL_DB'].map(key=>[key,env[key as keyof typeof env]])),cwd:fixture,command:'app/node_modules/.bin/tsx /tmp/axiom-rtk-official-implementation-hardened/run.ts'},null,2));
type C={id:string,command:string,cwd?:string,levels?:string[]};
const cases:C[]=[
{id:'status-ok',command:'git status'}, {id:'status-nongit',command:'git status',cwd:nongit}, {id:'status-path',command:'git status -- missing-path'},
{id:'log-ok',command:'git log -3'}, {id:'log-nongit',command:'git log -3',cwd:nongit}, {id:'log-bad-rev',command:'git log missing-revision'}, {id:'log-missing-path',command:'git log -- missing-path'},
{id:'diff-ok',command:'git diff'}, {id:'diff-nongit',command:'git diff',cwd:nongit}, {id:'diff-missing-path',command:'git diff -- missing-path'}, {id:'diff-bad-rev',command:'git diff missing-revision'},
{id:'diff-exit-changed',command:'git diff --exit-code'}, {id:'diff-exit-quiet-changed',command:'git diff --quiet --exit-code'}, {id:'diff-exit-clean',command:'git diff --exit-code -- sub/other.txt'},
{id:'ls-ok',command:'ls'}, {id:'ls-missing',command:'ls missing-path'}, {id:'ls-mixed',command:'ls tracked.txt missing-path'},
{id:'find-ok',command:'find . -name "*.txt"'}, {id:'find-missing',command:'find missing-path -name "*.txt"'}, {id:'find-no-match',command:'find . -name "absent*.zzz"'},
{id:'grep-ok',command:'grep -n needle tracked.txt'}, {id:'grep-no-match',command:'grep -n absent tracked.txt'}, {id:'grep-missing',command:'grep -n needle missing-path'}, {id:'grep-mixed',command:'grep -n needle tracked.txt missing-path'}, {id:'grep-invalid-regex',command:"grep '[' tracked.txt"},
{id:'and-ok',command:'git status && ls sub'}, {id:'and-failure',command:'ls missing-path && git status'}, {id:'or-failure',command:'ls missing-path || git status'}, {id:'or-grep-no-match',command:'grep absent tracked.txt || git status'},
{id:'and-diff-exit',command:'git diff --exit-code && ls sub'}, {id:'or-diff-exit',command:'git diff --exit-code || ls sub'},
{id:'multiline-ok',command:'git status\nls sub'}, {id:'multiline-failure-final',command:'git status\nls missing-path'}, {id:'multiline-failure-first',command:'ls missing-path\ngit status'},
{id:'pipe-terminal-grep',command:'cat tracked.txt | grep needle'}, {id:'pipe-terminal-grep-no-match',command:'cat tracked.txt | grep absent'}, {id:'pipe-terminal-grep-invalid',command:"cat tracked.txt | grep '['"},
{id:'pipe-producer-status',command:'git status | grep modified'}, {id:'pipe-producer-ls',command:'ls | grep tracked'}, {id:'pipe-producer-find',command:'find . -name "*.txt" | grep tracked'}, {id:'pipe-producer-grep',command:'grep needle tracked.txt | wc -l'},
{id:'status-porcelain-bypass',command:'git status --porcelain'}, {id:'find-print0-bypass',command:'find . -print0'}
];
const results=[];
for(const c of cases){
const cwd=c.cwd??fixture;const original=run('/bin/bash',['--noprofile','--norc','-c',c.command],cwd);
for(const level of ['balanced','aggressive'] as const){
const prefix=join(base,'logs',`${c.id}.${level}`);
const rewrite=run(binary,['rewrite',c.command],cwd);const eligibility=rtkRewriteEligibility(c.command);
const candidate=rewrite.stdout.trim();const bound=([0,3].includes(rewrite.code??-1))?bindRtkRewrite(root,c.command,candidate,binary,level):undefined;
const rewritten=bound?run('/bin/bash',['--noprofile','--norc','-c',bound],cwd):null;
const r={id:c.id,level,cwd,command:c.command,eligibility,rewrite,candidate,binder:bound?'accepted':'bypass',bound,original,rewritten,codePreserved:rewritten?original.code===rewritten.code:null,diagnosticPreserved:rewritten&&original.stderr?rewritten.stderr===original.stderr:null,originalBytes:Buffer.byteLength(original.stdout)+Buffer.byteLength(original.stderr),rewrittenBytes:rewritten?Buffer.byteLength(rewritten.stdout)+Buffer.byteLength(rewritten.stderr):null};
results.push(r);writeFileSync(prefix+'.json',JSON.stringify(r,null,2));
}
}
writeFileSync(join(base,'results.json'),JSON.stringify(results,null,2));
const lines=results.map(r=>`${r.id}\t${r.level}\t${r.binder}\t${r.rewrite.code}\t${r.original.code}\t${r.rewritten?.code??'-'}\t${r.codePreserved??'-'}\t${r.diagnosticPreserved??'-'}\t${r.originalBytes}\t${r.rewrittenBytes??'-'}`);
writeFileSync(join(base,'summary.tsv'),'case\tlevel\tbinder\trewriteCode\toriginalCode\trewrittenCode\tcodePreserved\tstderrExact\toriginalBytes\trewrittenBytes\n'+lines.join('\n')+'\n');
console.log(JSON.stringify({binary,version,cases:cases.length,pairs:results.length,accepted:results.filter(r=>r.binder==='accepted').length,exitMismatches:results.filter(r=>r.codePreserved===false).map(r=>({id:r.id,level:r.level,original:r.original.code,rewritten:r.rewritten?.code})),diagnosticChanges:results.filter(r=>r.diagnosticPreserved===false).map(r=>({id:r.id,level:r.level}))},null,2));
