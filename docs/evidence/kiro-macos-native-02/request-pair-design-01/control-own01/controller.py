import os,sys,json,time,subprocess,hashlib
from pathlib import Path
root=Path(__file__).parent
m=json.loads((root/'manifest.json').read_text());base=Path(m['repo'])
files=['CONTROL-FRAMES-CONTRACT.md','CONTROL-SOURCE-BINDING.json','control_frames.cjs','multiplex_reader.cjs','candidate_frames.cjs','traffic_values.cjs','node_http_adapter.cjs','undici_adapter.cjs']
def create(p,s):
 with open(p,'x') as f:f.write(s)
start=time.monotonic();before={};readbytes=0
(root/'source-originals').mkdir(mode=0o700)
for name in files:
 data=(base/name).read_bytes();readbytes+=len(data)
 before[name]={'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
 with open(root/'source-originals'/name,'xb') as f:f.write(data)
create(root/'source-before.json',json.dumps(before,indent=2))
binding=json.loads((root/'source-originals'/'CONTROL-SOURCE-BINDING.json').read_text())['files']
match=all(before[k]==v for k,v in binding.items())
cmd=[m['node'],str(root/'harness.cjs'),str(base)]
create(root/'command.json',json.dumps({'argv':cmd,'cwd':str(root),'stdin':'DEVNULL','stdout':'PIPE','stderr':'DEVNULL','timeoutSeconds':6,'env':'inherited; not read auth/config'},indent=2))
if not match: raise SystemExit(72)
launch=time.monotonic();code=None;timedout=False
try:
 proc=subprocess.run(cmd,cwd=root,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=6,check=False)
 code=proc.returncode;out=proc.stdout
except subprocess.TimeoutExpired as e:
 timedout=True;out=e.stdout or b''
nodeelapsed=time.monotonic()-launch
with open(root/'stdout-original.txt','xb') as f:f.write(out)
after={}
for name in files:
 data=(base/name).read_bytes();readbytes+=len(data);after[name]={'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
create(root/'source-after.json',json.dumps(after,indent=2))
result={'nodeInvocations':1,'modelRequests':0,'HTTPRequests':0,'harnessCases':16,'harnessAndAPICountsAreNotRequestCounts':True,'nodeExit':code,'controllerExit':0 if code==0 and before==after and not timedout else 1,'toolsBashExitCode':'unknown unless supplied by tool metadata','timedOut':timedout,'nodeElapsedSeconds':nodeelapsed,'controllerElapsedSeconds':time.monotonic()-start,'wholeTaskElapsedSeconds':'unknown: controller timing does not include earlier tool calls','prebindingMatch':match,'sourceUnchanged':before==after,'controllerMeasuredRepoSourceReadBytes':readbytes,'toolReadBudget':'separate self-report required','stderrBytes':'unknown (DEVNULL)','stdioEOF':'not observed; no dual-EOF claim','stdoutBytes':len(out),'testsNotRun':['old codec/adapters matrix','HTTP/model/native socket','exact full stream bytecap reachability'],'sourceArchive':str(root/'source-originals')}
create(root/'result.json',json.dumps(result,indent=2))
print(out.decode('ascii',errors='replace'),end='');print('ARTIFACT_IDENTITY '+str(root));sys.exit(result['controllerExit'])
