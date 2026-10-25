const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=path.resolve(__dirname,'../../..'),read=p=>fs.readFileSync(p,'utf8'),json=p=>JSON.parse(read(p)),sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const fields=json(path.join(__dirname,'serializer-fields.json'));
assert.equal(fields.sha256,'0ff1d24eea11aa2e244524d635e1cfc8f9820522f4c5bc192fb99590d909320a');
assert.equal(fields.bytes,528630968);
const asm={user:read(path.join(__dirname,'../kiro-inference/operation/user.asm.txt')),assistant:read(path.join(__dirname,'assistant.asm.txt')),reasoning:read(path.join(__dirname,'reasoning.asm.txt'))};
for(const [owner,required] of Object.entries({user:['envState','images','documents','cachePoint','clientCacheConfig'],assistant:['cachePoint','reasoningContent'],reasoning:['reasoningText','text','signature','redactedContent']})) for(const field of required) {
  const f=fields.fields.find(x=>x.owner===owner&&x.field===field);assert.ok(f,owner+'.'+field);
  assert.ok(asm[owner].includes(f.instructionVA.slice(2).toUpperCase()),'instruction '+field);
  assert.ok(asm[owner].includes(f.keyHelperCallVA.slice(2).toUpperCase()),'key call '+field);
}
assert.match(asm.assistant,/140BAEAFC:.*call\s+0000000140B80040/);
assert.match(read(path.join(__dirname,'../kiro-inference/operation/message.asm.txt')),/140BA16DC:.*call\s+0000000140BAE5A0/);
const runs=json(path.join(__dirname,'dumpbin-run.json'));assert.equal(runs.length,2);for(const r of runs){assert.equal(r.exitCode,0);assert.equal(r.stderr,'');}
const probe=json(path.join(__dirname,'adapter-probe.json'));assert.equal(probe.checksPassed,8);assert.equal(probe.checks.length,8);for(const c of probe.checks)assert.equal(c.passed,true);
for(const s of probe.sources)assert.equal(sha(path.resolve(__dirname,s.relative)),s.sha256,'probe source changed: '+s.relative);
const oldDir=path.join(__dirname,'../kiro-inference'),old=json(path.join(oldDir,'manifest.json'));assert.equal(old.files.length,79);let oldBytes=0;
for(const f of old.files){const p=path.join(oldDir,f.path);assert.equal(fs.statSync(p).size,f.bytes);assert.equal(sha(p),f.sha256);oldBytes+=f.bytes;}
const docs=['docs/kiro-cli-parity-audit.md','docs/kiro-inference-audit.md','docs/evidence/kiro-cli-parity/README.md'];let localLinks=0;
// Generated report can be the target of a README link before its first run.
const report=path.join(__dirname,'checks.json');
for(const name of docs){const p=path.join(root,name),md=read(p);for(const match of md.matchAll(/\]\(([^\s)]+)\)/g)){
  const url=match[1];if(/^(https?:|mailto:|#)/.test(url))continue;
  const [rel,fragment]=url.split('#'),target=path.resolve(path.dirname(p),decodeURIComponent(rel));
  assert.ok(fs.existsSync(target)||target===report,'missing link: '+name+' -> '+url);
  if(fragment&&/^L\d+$/.test(fragment))assert.ok(Number(fragment.slice(1))<=read(target).split('\n').length,'bad line '+url);
  localLinks++;
}}
const styled=[...docs,'docs/evidence/kiro-cli-parity/serializer-scan.cjs','docs/evidence/kiro-cli-parity/adapter-probe.ts','docs/evidence/kiro-cli-parity/check.cjs'];
for(const name of styled){const t=read(path.join(root,name));assert.ok(t.endsWith('\n'));assert.ok(!/[ \t]+\r?$/m.test(t),'trailing space: '+name);assert.ok(!/^\s*(?:<{7}|={7}|>{7})/m.test(t));assert.ok(!t.includes('\uFFFD'));}
const diff=cp.spawnSync('git',['diff','--check','--',...styled],{cwd:root,encoding:'utf8'});assert.equal(diff.status,0,diff.stdout+diff.stderr);
const inventory=fs.readdirSync(__dirname).filter(n=>n!=='checks.json').sort().map(n=>{const p=path.join(__dirname,n);return {path:n,bytes:fs.statSync(p).size,sha256:sha(p)};});
const out={passed:true,probeChecks:8,dumpbinRuns:2,oldManifest:{files:79,bytes:oldBytes,unchanged:true},localLinks,styledFiles:styled.length,scopedGitDiffCheckExit:diff.status,evidenceFiles:inventory};
fs.writeFileSync(report,JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out,null,2));
