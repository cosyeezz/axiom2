import os,sys,json,hashlib,subprocess,time,signal,resource
from pathlib import Path
root=Path(__file__).resolve().parent
manifest=json.loads((root/'manifest.json').read_text())
base=Path(manifest['sourceRoot']); binding=json.loads((base/'CHANNEL-SOURCE-BINDING.json').read_text())['files']
def save(name,value):
 with open(root/name,'x') as f: json.dump(value,f,indent=2); f.write('\n')
def identities():
 out={}
 for n,expected in binding.items():
  b=(base/n).read_bytes(); out[n]={'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
 return out
before=identities();save('source-before.json',before)
if before!=binding: save('failure.json',{'fault':'source-binding'});sys.exit(72)
artifact={}
for n in ['manifest.json','controller.py','harness.cjs','child.cjs']:
 b=(root/n).read_bytes();artifact[n]={'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
save('fixture-binding.json',artifact)
with open(root/'RUN.lock','x') as f:f.write('one-shot\n')
argv=[manifest['node'],str(root/'harness.cjs')]
env={'HOME':str(root),'TMPDIR':str(root),'PATH':'/usr/bin:/bin','LANG':'C','LC_ALL':'C'}
save('command.json',{'argv':argv,'cwd':str(root),'passedEnv':env,'stdin':'DEVNULL','stdout':'DEVNULL','stderr':'DEVNULL','timeoutSeconds':10,'newOwnProcessSession':True})
resource.setrlimit(resource.RLIMIT_CORE,(0,0))
start=time.monotonic()
p=subprocess.Popen(argv,cwd=root,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
timed=False
try: code=p.wait(timeout=10)
except subprocess.TimeoutExpired:
 timed=True
 try: os.killpg(p.pid,signal.SIGKILL)
 except ProcessLookupError: pass
 code=p.wait(timeout=2)
elapsed=time.monotonic()-start
after=identities();save('source-after.json',after)
save('controller-result.json',{'heldPID':p.pid,'waitExit':code,'timedOut':timed,'elapsedSeconds':elapsed,'sourceUnchanged':before==after,'nodeHarnessLaunches':1,'repoSourceReadBytes':2*sum(v['bytes'] for v in before.values()),'stdio':'DEVNULL; no byte counts or EOF evidence','wholeAuthorWall':'unknown','completeProcessTreeProof':False})
print(json.dumps({'heldPID':p.pid,'waitExit':code,'timedOut':timed,'sourceUnchanged':before==after,'root':str(root)}))
sys.exit(0 if code==0 and not timed and before==after else 1)
