import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {rtkRewriteEligibility,bindRtkRewrite} from '/Volumes/D_Work/axiom2/app/src/server/integrations/rtk-rewrite.ts';
const base='/tmp/axiom-rtk-official-implementation-hardened';
const m=JSON.parse(readFileSync(base+'/metadata.json','utf8'));
const cases=[
 ...['time git status','env git status','command git status','eval git status','source missing-script','hash -p /bin/false git'].map(source=>({id:source.split(' ')[0]+'-standalone',source})),
 ...['time git status','env git status','command git status','eval git status','source missing-script','hash -p /bin/false git'].map(source=>({id:source.split(' ')[0]+'-list',source:source+'; git status'})),
 ...[['NBSP','\u00a0'],['VT','\u000b'],['FF','\u000c']].flatMap(([name,separator])=>[
 {id:name+'-between-command-args',source:'git'+separator+'status'},
 {id:name+'-before-rtk',source:'git status;'+separator+'rtk ls'},
 {id:name+'-quoted',source:'git status -- "a'+separator+'b"'},
 ]),
];
const results=cases.map(({id,source})=>{
 const r=spawnSync(m.binary,['rewrite',source],{cwd:m.cwd,env:{...process.env,...m.env},encoding:'utf8',timeout:15000,maxBuffer:4*1024*1024});
 const rewrite={code:r.status,signal:r.signal,error:r.error?.message,stdout:r.stdout??'',stderr:r.stderr??''};
 const candidate=rewrite.stdout.trim();
 const eligibility=rtkRewriteEligibility(source);
 const levels=['balanced','aggressive'].map(level=>({level,binder:bindRtkRewrite(base+'/root',source,candidate,m.binary,level as any)?'accepted':'bypass',candidateGate:bindRtkRewrite(base+'/root','git status',candidate,m.binary,level as any)?'accepted':'bypass'}));
 return {id,source,eligibility,rewrite,candidate,levels};
});
const checks=[
 {name:'all official rewrite subprocesses complete; 1 is no rewrite',ok:results.every(r=>[0,1,3].includes(r.rewrite.code??-1)&&!r.rewrite.signal&&!r.rewrite.error)},
 {name:'all unsafe sources rejected by eligibility',ok:results.every(r=>r.eligibility==='rewrite_policy')},
 {name:'all unsafe source official candidates rejected by binder both levels',ok:results.every(r=>r.levels.every(l=>l.binder==='bypass'))},
 // candidateGate is observation only: official normalization can remove unsafe whitespace.
 // Production binder must receive the real original source, never a substituted safe one.
];
const report={pass:checks.every(c=>c.ok),businessExecutions:0,cases:results.length,pairs:results.length*2,accepted:results.flatMap(r=>r.levels).filter(l=>l.binder==='accepted').length,rewriteCodes:Object.fromEntries([...new Set(results.map(r=>r.rewrite.code))].map(code=>[String(code),results.filter(r=>r.rewrite.code===code).length])),checks,results};
writeFileSync(base+'/extra.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));process.exitCode=report.pass?0:1;
