import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {bindRtkRewrite} from '/Volumes/D_Work/axiom2/app/src/server/integrations/rtk-rewrite.ts';
const base='/tmp/axiom-rtk-official-implementation-final-safe';
const read=(n:string)=>JSON.parse(readFileSync(base+'/'+n,'utf8'));
const main=read('results.json'),supp=read('supplement.json'),all=[...main,...supp],m=read('metadata.json');
const checks:any[]=[];
function check(name:string,ok:boolean,detail?:any){checks.push({name,ok,detail});}
check('43 main x 2 + 16 supplement x 2',main.length===86&&supp.length===32);
check('managed absolute binary version 1.0.1',m.binary.startsWith('/Users/')&&m.version.code===0&&m.version.stdout.trim()==='rtk 1.0.1',m.binary);
const accepted=all.filter(r=>r.binder==='accepted');
check('accepted codePreserved false count = 0',accepted.filter(r=>r.codePreserved===false).length===0);
check('all accepted exit codes actually equal, no signals/errors',accepted.every(r=>r.original.code!==null&&r.original.code===r.rewritten.code&&!r.original.signal&&!r.rewritten.signal&&!r.original.error&&!r.rewritten.error));
check('no original/rewrite timeout or spawn error',all.every(r=>!r.original.error&&!r.original.signal&&!r.rewrite.error&&!r.rewrite.signal));
const source=(r:any)=>r.command??r.source;
const finds=all.filter(r=>/(^|[\n|&;]\s*|\s)find\s/.test(source(r)));
check('all source find bypass',finds.length===22&&finds.every(r=>r.binder==='bypass'),finds.length);
const generated=all.filter(r=>/\brtk find\b/.test(r.candidate??r.rewrite.stdout));
check('all official-generated rtk find bypass',generated.length>0&&generated.every(r=>r.binder==='bypass'),generated.length);
const probes=[];
for(const level of ['balanced','aggressive'] as const)for(const candidate of ['rtk find .','rtk ls && rtk find missing-path','rtk ls || rtk find .','rtk ls\nrtk find .']){
 const bound=bindRtkRewrite(base+'/root','ls',candidate,m.binary,level);probes.push({level,candidate,binder:bound?'accepted':'bypass'});
}
check('generated find rejected even with non-find source',probes.every(p=>p.binder==='bypass'),probes);
const flowCodes:any={'and-ok':0,'and-failure':1,'or-failure':0,'or-grep-no-match':0,'and-diff-exit':1,'or-diff-exit':0,'multiline-ok':0,'multiline-failure-final':1,'multiline-failure-first':0};
const flows=main.filter(r=>r.id in flowCodes&&r.binder==='accepted');
check('accepted && || multiline expected exit',flows.every(r=>r.rewritten.code===flowCodes[r.id]),flows.length);
check('and failure skips RHS status',flows.filter(r=>r.id==='and-failure').every(r=>r.rewritten.stdout===''));
check('diff failure skips && RHS',flows.filter(r=>r.id==='and-diff-exit').every(r=>!r.rewritten.stdout.includes('other.txt')));
check('success and/or/newline execute RHS',flows.filter(r=>['and-ok','or-diff-exit','multiline-ok'].includes(r.id)).every(r=>r.rewritten.stdout.includes('other.txt')));
check('fallback/newline status actually executed',flows.filter(r=>['or-failure','or-grep-no-match','multiline-failure-first','multiline-failure-final'].includes(r.id)).every(r=>r.rewritten.stdout.includes('tracked.txt')));
const diagChecks=[];
for(const r of accepted.filter(r=>r.original.stderr)){
 const text=r.rewritten.stderr;let regex:RegExp;
 const id=r.id??r.source;
 if(/nongit/.test(id))regex=/not a git repository/i;
 else if(/bad-rev/.test(id))regex=/missing-revision.*unknown revision/;
 else if(/invalid/.test(id))regex=/brackets.*not balanced/;
 else if(/bogus/.test(id))regex=/bogus/;
 else regex=/missing-path.*No such file or directory/;
 diagChecks.push({id,level:r.level,ok:regex.test(text),stderrExact:r.original.stderr===text});
}
check('all accepted error cases retain key diagnostics',diagChecks.length>0&&diagChecks.every(r=>r.ok),diagChecks);
check('quiet changed diff stays silent and 1',main.filter(r=>r.id==='diff-exit-quiet-changed'&&r.binder==='accepted').every(r=>r.rewritten.code===1&&r.rewritten.stdout===''&&r.rewritten.stderr===''));
check('accepted terminal pipelines preserve data exactly',main.filter(r=>r.id.startsWith('pipe-')&&r.binder==='accepted').every(r=>r.original.stdout===r.rewritten.stdout&&r.original.stderr===r.rewritten.stderr));
const old='/tmp/axiom-rtk-official-implementation/';
check('initial matrix artifacts unchanged',Object.entries(read('initial-matrix-sha256.json')).every(([n,hash])=>createHash('sha256').update(readFileSync(old+n)).digest('hex')===hash));
const keys=['HOME','XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_CACHE_HOME','NO_COLOR','LC_ALL','GIT_CONFIG_NOSYSTEM','GIT_CONFIG_GLOBAL','GIT_PAGER','PAGER','RTK_TELEMETRY_DISABLED','DO_NOT_TRACK','RTK_RECALL','RTK_TEE','RTK_DB_PATH','RTK_RECALL_DB'];
check('metadata env contains only explicit whitelist',Object.keys(m.env).length===keys.length&&Object.keys(m.env).every(k=>keys.includes(k)));
const report={pass:checks.every(c=>c.ok),main:{pairs:main.length,accepted:main.filter(r=>r.binder==='accepted').length},supplement:{pairs:supp.length,accepted:supp.filter(r=>r.binder==='accepted').length},accepted:accepted.length,bypass:all.length-accepted.length,acceptedCodePreservedFalse:accepted.filter(r=>r.codePreserved===false).length,stderrChanged:diagChecks.filter(r=>!r.stderrExact).length,checks};
writeFileSync(base+'/verification.json',JSON.stringify(report,null,2));
writeFileSync(base+'/supplement-summary.tsv','source\tlevel\tbinder\toriginalCode\trewrittenCode\tcodePreserved\n'+supp.map(r=>[JSON.stringify(r.source),r.level,r.binder,r.original.code,r.rewritten?.code??'-',r.codePreserved??'-'].join('\t')).join('\n')+'\n');
console.log(JSON.stringify(report,null,2));process.exitCode=report.pass?0:1;
