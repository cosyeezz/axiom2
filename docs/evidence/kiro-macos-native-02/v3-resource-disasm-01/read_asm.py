#!/usr/bin/env python3
import hashlib,json,resource,subprocess,time
from pathlib import Path
root=Path(__file__).resolve().parent;out=root/'verification.json'
if out.exists() or (root/'lldb-asm.txt').exists():raise SystemExit('CreateNew gate')
thin=Path('/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/kiro-mac-request-static01-ru8luby5/chat-arm64.macho')
h=hashlib.sha256()
with thin.open('rb') as f:
 for chunk in iter(lambda:f.read(1048576),b''):h.update(chunk)
assert h.hexdigest()=='558b27343a899ea123db9f9edb52c6bb2f65d712fe4c137919feab490bf620f7'
def limits():
 resource.setrlimit(resource.RLIMIT_CPU,(20,20));resource.setrlimit(resource.RLIMIT_FSIZE,(1048576,1048576))
argv=['/usr/bin/lldb','--no-lldbinit','--batch','-o','target create '+json.dumps(str(thin)),'-o','disassemble --bytes --start-address 0x101631f3c --end-address 0x101634f40']
t0=time.monotonic();reason=None
with (root/'lldb-asm.txt').open('xb') as stdout, (root/'lldb-stderr.txt').open('xb') as stderr:
 try:p=subprocess.run(argv,stdout=stdout,stderr=stderr,stdin=subprocess.DEVNULL,timeout=25,preexec_fn=limits);code=p.returncode
 except subprocess.TimeoutExpired:reason='timeout';code=None
s=(root/'lldb-asm.txt').read_bytes();e=(root/'lldb-stderr.txt').read_bytes()
r={'schema':'kas-resource-offline-asm-1','status':'captured_static_asm_only' if code==0 and reason is None and len(s)<1048576 and len(e)<=65536 else 'failed_capture','sourceSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'thin':str(thin),'thinSha256':h.hexdigest(),'argv':argv,'functionStart':'0x101631f3c','functionEndExclusive':'0x101634f40','functionBytes':12292,'exitCode':code,'stopReason':reason,'elapsedSeconds':round(time.monotonic()-t0,3),'stdoutBytes':len(s),'stdoutSha256':hashlib.sha256(s).hexdigest(),'stderrBytes':len(e),'stderrSha256':hashlib.sha256(e).hexdigest(),'targetLaunches':0,'targetAttaches':0,'modelRequests':0,'boundary':'Linear offline ASM of one located function, not CFG or effective runtime/source identity proof.'}
with out.open('x') as f:json.dump(r,f,indent=2);f.write('\n')
print(json.dumps(r,indent=2));raise SystemExit(0 if r['status']=='captured_static_asm_only' else 1)
