import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs, { mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync,statSync,utimesSync,symlinkSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionProfiles } from '../src/server/execution-profile.js';
import { resourceIdentity, resourceIdentityAsync } from '../src/server/agents/resource-identity.js';

test('async resource verification preserves ordered bytes and rechecks config after I/O',async()=>{
  const root=mkdtempSync(join(tmpdir(),'axiom-resource-async-')),cwd=join(root,'project'),pi=join(root,'pi'),skills=join(cwd,'.pi','skills');
  mkdirSync(skills,{recursive:true});mkdirSync(pi);
  const raw='{"providers":{}}';writeFileSync(join(pi,'models.json'),raw);
  for(let index=0;index<20;index++)writeFileSync(join(skills,`${index}-中文.md`),Buffer.from([index,0xff,0xfe,0,0x80]));
  const profiles=new ExecutionProfiles(root),input={entry:'agent' as const,cwd,modelDir:pi,modelsRaw:raw,mode:'D' as const};
  let sync:ReturnType<ExecutionProfiles['prepare']>|undefined,asyncEnvironment:ReturnType<ExecutionProfiles['prepare']>|undefined;
  try{
    assert.equal(await resourceIdentityAsync(cwd,pi),resourceIdentity(cwd,pi));
    sync=profiles.prepare(input);asyncEnvironment=await profiles.prepareAsync(input);assert.equal(asyncEnvironment.profileHash,sync.profileHash);
    assert.equal(await asyncEnvironment.currentAsync!(),true);
    const checking=asyncEnvironment.currentAsync!();writeFileSync(join(pi,'auth.json'),'{"changed":true}');
    assert.equal(await checking,false,'credentials changed during asynchronous I/O cannot pass');
    const controller=new AbortController(),cancelled=resourceIdentityAsync(cwd,pi,controller.signal);controller.abort();await assert.rejects(cancelled);
  }finally{sync?.release();asyncEnvironment?.release();rmSync(root,{recursive:true,force:true});}
});

test('concurrent scans bound reads globally and recover after a queued cancellation and read error', async t => {
  const root=mkdtempSync(join(tmpdir(),'axiom-resource-capacity-')),cwd=join(root,'project'),pi=join(root,'pi'),skills=join(cwd,'.pi','skills');
  mkdirSync(skills,{recursive:true});mkdirSync(pi);
  for(let i=0;i<20;i++)writeFileSync(join(skills,`${i}.md`),'fixture contents');
  const handle=await fs.promises.open(join(skills,'0.md'),'r'),prototype=Object.getPrototypeOf(handle),read=prototype.read;
  await handle.close();
  let entered!:()=>void,release!:()=>void,active=0,peak=0,fail=true;
  const saturated=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{release=r;});
  const patched=t.mock.method(prototype,'read',async function(this:any,...args:any[]) {
    active++;peak=Math.max(peak,active);if(active===8)entered();
    try { await gate;if(fail){fail=false;throw Error('fixture read failure');}return await read.apply(this,args); }
    finally { active--; }
  });
  const controller=new AbortController();
  try {
    const failed=resourceIdentityAsync(cwd,pi),cancelled=resourceIdentityAsync(cwd,pi,controller.signal),survivor=resourceIdentityAsync(cwd,pi);
    const completed=Promise.all([assert.rejects(failed,/fixture read failure/),assert.rejects(cancelled),survivor]);
    await saturated;controller.abort();release();
    const results=await completed;
    assert.equal(peak,8);assert.equal(active,0);
    assert.equal(results[2],resourceIdentity(cwd,pi));
    assert.equal(await resourceIdentityAsync(cwd,pi),resourceIdentity(cwd,pi));
  } finally { release();patched.mock.restore();rmSync(root,{recursive:true,force:true}); }
});

for (const mutation of ['earlier-file', 'directory-entry', 'missing-parent', 'deleted-file', 'unrelated-entry'] as const) {
  test(`async inspection distinguishes resource changes from unrelated entries: ${mutation}`, async t => {
    const root=mkdtempSync(join(tmpdir(),'axiom-resource-race-')),cwd=join(root,'project'),pi=join(root,'missing-pi'),skills=join(cwd,'.pi','skills');
    mkdirSync(skills,{recursive:true});
    if(mutation==='unrelated-entry')mkdirSync(pi);
    for(let index=0;index<20;index++)writeFileSync(join(skills,`${String(index).padStart(2,'0')}.md`),`${index} content`);
    const first=join(skills,'00.md'),handle=await fs.promises.open(first,'r'),prototype=Object.getPrototypeOf(handle),read=prototype.read;
    await handle.close();
    let changed=false;
    const patched=t.mock.method(prototype,'read',async function(this: any,...args: any[]) {
      const result=await read.apply(this,args);
      if(!changed && (args[0] as Buffer).toString().startsWith('10 content')) {
        changed=true;
        if(mutation==='earlier-file') { const stat=statSync(first);writeFileSync(first,'x content');utimesSync(first,stat.atime,stat.mtime); }
        if(mutation==='directory-entry')writeFileSync(join(skills,'added.md'),'new resource');
        if(mutation==='missing-parent') { mkdirSync(pi);writeFileSync(join(pi,'AGENTS.md'),'new instructions'); }
        if(mutation==='deleted-file')rmSync(first);
        if(mutation==='unrelated-entry')writeFileSync(join(pi,'settings.lock'),'unrelated SDK file');
      }
      return result;
    });
    try {
      if(mutation==='unrelated-entry')assert.equal(await resourceIdentityAsync(cwd,pi),resourceIdentity(cwd,pi));
      else await assert.rejects(resourceIdentityAsync(cwd,pi),/Resource changed/);
      assert.equal(changed,true,'mutation occurs during the later read batch');
      patched.mock.restore();
      assert.equal(await resourceIdentityAsync(cwd,pi),resourceIdentity(cwd,pi),'failed reads release capacity for a fresh scan');
    } finally { patched.mock.restore();rmSync(root,{recursive:true,force:true}); }
  });
}

test('resource scanning detects new ancestor resources and rejects nested and root directory links',()=>{
  const root=mkdtempSync(join(tmpdir(),'axiom-resource-tree-')),cwd=join(root,'project'),pi=join(root,'agent');
  mkdirSync(cwd);mkdirSync(pi);
  try{
    const before=resourceIdentity(cwd,pi);
    writeFileSync(join(cwd,'unrelated.ts'),'ordinary project source');assert.equal(resourceIdentity(cwd,pi),before);
    const skills=join(root,'.pi','skills'),skill=join(skills,'fixture');mkdirSync(skill,{recursive:true});
    writeFileSync(join(skill,'SKILL.md'),'first');const after=resourceIdentity(cwd,pi);assert.notEqual(after,before);
    const timestamp=statSync(join(skill,'SKILL.md'));writeFileSync(join(skill,'SKILL.md'),'other');utimesSync(join(skill,'SKILL.md'),timestamp.atime,timestamp.mtime);
    assert.notEqual(resourceIdentity(cwd,pi),after,'full contents remain authoritative even with a restored timestamp');
    writeFileSync(join(skill,'large.bin'),Buffer.alloc(1024*1024+1));assert.throws(()=>resourceIdentity(cwd,pi),/inspection budget/);rmSync(join(skill,'large.bin'));
    const outside=join(root,'outside');mkdirSync(outside);symlinkSync(outside,join(skills,'linked'),'junction');
    assert.throws(()=>resourceIdentity(cwd,pi),/Linked resource/);rmSync(join(skills,'linked'));
    symlinkSync(outside,join(cwd,'.pi'),'junction');assert.throws(()=>resourceIdentity(cwd,pi),/Linked resource/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('profiles use effective content and owned snapshot references, never request identity or random snapshot paths',()=>{
  const root=mkdtempSync(join(tmpdir(),'axiom-profiles-')),cwd=join(root,'project'),modelDir=join(root,'shared-pi');mkdirSync(cwd);mkdirSync(modelDir);
  const raw='{"providers":{}}';writeFileSync(join(modelDir,'models.json'),raw);writeFileSync(join(modelDir,'auth.json'),'{}');
  const profiles=new ExecutionProfiles(root),input={entry:'memory' as const,cwd,modelDir,modelsRaw:raw,mode:'D' as const};
  try {
    const a=profiles.prepare({...input,selection:{provider:'one',id:'one',thinking:'off'}}),b=profiles.prepare({...input,selection:{provider:'two',id:'two',thinking:'off'}});
    assert.notEqual(a.profileHash,b.profileHash,'workers own a single provider network for their lifetime');assert.equal(a.modelsFile,b.modelsFile);assert.equal(a.current(),true);
    const sameProvider=profiles.prepare({...input,selection:{provider:'one',id:'different-model',thinking:'high'}});
    assert.equal(a.profileHash,sameProvider.profileHash,'model changes within one provider remain binding-only');sameProvider.release();
    a.retain();a.release();b.release();assert.equal(existsSync(a.modelsFile),true,'instance retains its environment after requests release');
    a.release();assert.equal(profiles.size,0);assert.equal(existsSync(a.modelsFile),false);
    const c=profiles.prepare(input);writeFileSync(join(cwd,'unrelated.ts'),'business source');assert.equal(c.current(),true);
    const formatted = '{\n  "providers": {}\n}';
    writeFileSync(join(modelDir,'models.json'), formatted);
    const equivalent = profiles.prepare({...input, modelsRaw: formatted});
    assert.equal(equivalent.profileHash, c.profileHash); assert.equal(c.current(), true); equivalent.release();
    writeFileSync(join(modelDir,'auth.json'),'{"updated":true}');assert.equal(c.current(),false,'partial credential write invalidates before overall save succeeds');
    const d=profiles.prepare(input);assert.notEqual(c.profileHash,d.profileHash);c.release();d.release();
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('agent resource contents and corrupted snapshot invalidate reuse even if modification time is restored',()=>{
  const root=mkdtempSync(join(tmpdir(),'axiom-profile-resources-')),cwd=join(root,'project'),modelDir=join(root,'pi');mkdirSync(cwd);mkdirSync(modelDir);
  const raw='{"providers":{}}';writeFileSync(join(modelDir,'models.json'),raw);const instructions=join(cwd,'AGENTS.md');writeFileSync(instructions,'first');
  const profiles=new ExecutionProfiles(root),input={entry:'agent' as const,cwd,modelDir,modelsRaw:raw,mode:'C' as const};
  const a=profiles.prepare(input);
  try{const old=statSync(instructions);writeFileSync(instructions,'other');utimesSync(instructions,old.atime,old.mtime);assert.equal(a.current(),false);
    assert.equal(a.current(false),true,'intermediate check defers only resource traversal to binding checks');
    writeFileSync(join(modelDir,'auth.json'),'{"changed":true}');assert.equal(a.current(false),false,'intermediate check still rejects credential changes');
    writeFileSync(a.modelsFile,'corrupt');assert.equal(a.snapshotValid(),false);
    const b=profiles.prepare(input);
    assert.notEqual(b.modelsFile,a.modelsFile,'replacement never mutates a snapshot still owned by another instance');
    assert.equal(b.snapshotValid(),true);
    a.release();
    const c=profiles.prepare(input);
    assert.equal(c.modelsFile,b.modelsFile,'old owner release cannot delete the replacement registry entry');
    assert.equal(a.snapshotValid(),false);
    b.release();c.release();
    assert.equal(profiles.size,0);
  } finally { a.release(); rmSync(root,{recursive:true,force:true}); }
});

test('snapshot deletion failure releases ownership and is retried on service startup', t => {
  const root=mkdtempSync(join(tmpdir(),'axiom-profile-cleanup-')),cwd=join(root,'project'),modelDir=join(root,'pi');
  mkdirSync(cwd);mkdirSync(modelDir);
  const profiles=new ExecutionProfiles(root);
  const environment=profiles.prepare({entry:'memory',cwd,modelDir,modelsRaw:'{"providers":{}}',mode:'D'});
  const remove=fs.rmSync;
  const mock=t.mock.method(fs,'rmSync',((path: unknown, ...args: unknown[])=>{
    if(path===environment.modelsFile)throw Object.assign(Error('fixture file lock'),{code:'EBUSY'});
    return (remove as any)(path,...args);
  }) as typeof fs.rmSync);
  syncBuiltinESMExports();
  try {
    assert.doesNotThrow(()=>environment.release());
    assert.equal(profiles.size,0);
    assert.equal(existsSync(environment.modelsFile),true);
    mock.mock.restore();syncBuiltinESMExports();
    new ExecutionProfiles(root);
    assert.equal(existsSync(environment.modelsFile),false);
  } finally {mock.mock.restore();syncBuiltinESMExports();rmSync(root,{recursive:true,force:true});}
});

test('native catalog without models.json is valid; unverified external resources cannot be reused or prewarmed', () => {
  const root=mkdtempSync(join(tmpdir(),'axiom-profile-native-')),cwd=join(root,'project'),modelDir=join(root,'pi');
  mkdirSync(cwd);mkdirSync(modelDir);
  const profiles=new ExecutionProfiles(root), input={entry:'agent' as const,cwd,modelDir,modelsRaw:'{"providers":{}}',mode:'D' as const};
  try {
    const native=profiles.prepare(input); assert.equal(native.current(),true); native.release();
    writeFileSync(join(modelDir,'settings.json'),JSON.stringify({packages:['../external-package']}));
    const cold=profiles.prepare(input);
    assert.equal(cold.reuse,'single-use');assert.equal(cold.prewarmAllowed,false);assert.equal(cold.current(),true);
    cold.release();
  } finally {rmSync(root,{recursive:true,force:true});}
});
