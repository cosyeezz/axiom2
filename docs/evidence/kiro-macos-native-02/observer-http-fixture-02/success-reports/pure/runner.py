import os,sys,time,json,hashlib,subprocess,selectors,resource,signal,pathlib,difflib
P=pathlib.Path(__file__).parent
NODE='/Users/dane/.local/share/pi-node/node-v22.23.2-darwin-arm64/bin/node'
SOURCE=pathlib.Path('/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02/observer-http-fixture-02/fake-http-tap.cjs')
EXPECTED='f21dbb781ae4d106763ef327defd0c47f7100cc358a1343fd30d6997de2fc77a'
start=time.monotonic();totalout=0;results=[]
env={'HOME':str(P/'home'),'TMPDIR':str(P/'tmp'),'PATH':str(pathlib.Path(NODE).parent),'LANG':'C','LC_ALL':'C'}
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(SOURCE)==EXPECTED
assert (P/'suite.cjs').read_bytes()==pathlib.Path('/private/tmp/axiom-pure-audit.kHr4ztJX/suite.cjs').read_bytes()
old=(SOURCE.parent.parent/'observer-http-fixture-01'/'fake-http-tap.cjs').read_text()
changes=[
("  const ids = new WeakMap();","  let pendingBodyBytes = 0;\n  const ids = new WeakMap();"),
("      let bytes;\n", "      let bytes;\n      const available = limit.bodyBytes - state.bodyBytes - pendingBodyBytes;\n"),
("length > limit.bodyBytes - state.bodyBytes", "length > available"),
("value.byteLength > limit.bodyBytes - state.bodyBytes", "value.byteLength > available"),
("        try { id = identify(this); if (state.ok) input = sample(args, kind); }\n        catch (_) { fault('observer-input-failed'); }", "        let reserved = 0;\n        try {\n          id = identify(this);\n          if (state.ok) {\n            input = sample(args, kind);\n            if (input.cap) fault('body-cap');\n            else if (!input.unavailable) {\n              reserved = input.bytes;\n              pendingBodyBytes += reserved;\n            }\n          }\n        } catch (_) { fault('observer-input-failed'); }"),
("          emit({ kind, id, originalReturned: false });", "          pendingBodyBytes -= reserved;\n          emit({ kind, id, originalReturned: false });"),
("        if (input && input.cap) fault('body-cap');", "        pendingBodyBytes -= reserved;\n        if (input && input.cap) fault('body-cap');"),
("status() { return Object.assign({}, state); }", "status() { return Object.assign({}, state, { pendingBodyBytes }); }"),
("      fs.writeFileSync(trace + '.status.json', JSON.stringify(automatic.status()) + '\\n',", "      const terminal = automatic.status();\n      if (terminal.pendingBodyBytes !== 0) {\n        terminal.ok = false;\n        terminal.reason = terminal.reason || 'unfinished-original-call';\n      }\n      fs.writeFileSync(trace + '.status.json', JSON.stringify(terminal) + '\\n',")]
for a,b in changes:
 assert old.count(a)==1,repr(a)
 old=old.replace(a,b)
assert old==SOURCE.read_text(),'unexpected source delta'
with (P/'delta-audit.json').open('x') as f:json.dump({'kind':'exact text transformation (not AST)','approvedEdits':len(changes),'matchesEntire02':True,'note':'reservation/rollback + available/pending and terminal nonzero rejection only; 01 not executed'},f,indent=2)
def run(label,args):
 global totalout
 cpuused=resource.getrusage(resource.RUSAGE_CHILDREN);remaining=max(1,int(30-cpuused.ru_utime-cpuused.ru_stime))
 def limits():
  resource.setrlimit(resource.RLIMIT_CPU,(remaining,remaining))
  resource.setrlimit(resource.RLIMIT_CORE,(0,0))
 command=[NODE]+args
 proc=subprocess.Popen(command,cwd=P,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,preexec_fn=limits)
 sel=selectors.DefaultSelector();sel.register(proc.stdout,selectors.EVENT_READ,'stdout');sel.register(proc.stderr,selectors.EVENT_READ,'stderr')
 data={'stdout':bytearray(),'stderr':bytearray()};reason=None;childstart=time.monotonic()
 while sel.get_map():
  if time.monotonic()-start>60 or time.monotonic()-childstart>10:reason='timeout'
  if reason:
   try:os.killpg(proc.pid,signal.SIGKILL)
   except ProcessLookupError:pass
  for key,_ in sel.select(.03):
   chunk=os.read(key.fileobj.fileno(),65536)
   if not chunk:sel.unregister(key.fileobj);continue
   totalout+=len(chunk);data[key.data].extend(chunk)
   if len(data[key.data])>1048576 or totalout>4194304:reason='output-cap'
 rc=proc.wait();sel.close()
 for stream,blob in data.items():
  with (P/(label+'.'+stream)).open('xb') as f:f.write(blob[:1048576])
 result={'label':label,'command':command,'cwd':str(P),'pid':proc.pid,'exit':rc,'failure':reason,'truePipeEOF':True,'bytes':{k:len(v) for k,v in data.items()}}
 results.append(result)
 print(json.dumps(result),flush=True)
 return rc!=0 or reason is not None
failed=run('version',['--version'])
for group in ['core','chunks','caps','audit']:
 failed=run(group,[str(P/'suite.cjs'),str(SOURCE),group]) or failed
failed=run('extra',[str(P/'extra.cjs'),str(SOURCE),'extra']) or failed
assert sha(SOURCE)==EXPECTED
cpu=resource.getrusage(resource.RUSAGE_CHILDREN)
summary={'sourceSHABefore':EXPECTED,'sourceSHAAfter':sha(SOURCE),'unchangedOriginalSuite':True,'env':env,'limits':{'totalSeconds':60,'childSeconds':10,'totalCPUSeconds':30,'eachStreamBytes':1048576,'totalOutputBytes':4194304},'elapsed':time.monotonic()-start,'childCPU':cpu.ru_utime+cpu.ru_stime,'results':results,'exit':int(bool(failed))}
with (P/'results.json').open('x') as f:json.dump(summary,f,indent=2)
sys.exit(summary['exit'])
