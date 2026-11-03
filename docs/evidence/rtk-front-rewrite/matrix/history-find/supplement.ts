import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {bindRtkRewrite} from '/Volumes/D_Work/axiom2/app/src/server/integrations/rtk-rewrite.ts';
const base='/tmp/axiom-rtk-official-implementation',m=JSON.parse(readFileSync(base+'/metadata.json','utf8')),root=base+'/root';
const run=(f:string,a:string[])=>{const r=spawnSync(f,a,{cwd:m.cwd,env:m.env,encoding:'utf8',timeout:15000});return {code:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr,error:r.error?.message};};
const results=[];
for(const source of ['find missing-path && ls sub','find missing-path || ls sub','git status\nfind missing-path','git status | cat','git log -3 | cat','git diff | cat','ls | wc -l','find . -name "*.txt" | wc -l','grep needle tracked.txt | cat','find missing-path','find . -bogus','git status --bogus','git log --bogus','ls --bogus','grep -q absent tracked.txt','grep -q needle missing-path']){
const original=run('/bin/bash',['--noprofile','--norc','-c',source]);const rewrite=run(m.binary,['rewrite',source]);
for(const level of ['balanced','aggressive'] as const){const bound=[0,3].includes(rewrite.code??-1)?bindRtkRewrite(root,source,rewrite.stdout.trim(),m.binary,level):undefined;const rewritten=bound?run('/bin/bash',['--noprofile','--norc','-c',bound]):null;results.push({source,level,original,rewrite,binder:bound?'accepted':'bypass',bound,rewritten});}}
writeFileSync(base+'/supplement.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results.map(r=>({source:r.source,level:r.level,binder:r.binder,candidate:r.rewrite.stdout,original:r.original.code,rewritten:r.rewritten?.code,stderrOriginal:r.original.stderr,stderrRewritten:r.rewritten?.stderr})),null,2));
