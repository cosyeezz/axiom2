import os,sys,json,time,hashlib,subprocess,selectors,resource
from pathlib import Path
root=Path(__file__).parent
node='/Users/dane/.local/share/pi-node/node-v22.23.2-darwin-arm64/bin/node'
source=Path('/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02/observer-http-fixture-01/fake-http-tap.cjs')
expected='dbe252b5219077352a1a36f45f1939178f53e812fdc6b125d715776437a026ad'
sha=lambda:hashlib.sha256(source.read_bytes()).hexdigest()
start=time.monotonic();before=sha();results=[];total=0
assert before==expected,(before,expected)
def limits():
 resource.setrlimit(resource.RLIMIT_CPU,(30,30))
 resource.setrlimit(resource.RLIMIT_FSIZE,(1048576,1048576))
for group in ['core','chunks','caps','audit']:
 child=root/group;child.mkdir();(child/'home').mkdir();(child/'tmp').mkdir()
 env={'HOME':str(child/'home'),'TMPDIR':str(child/'tmp'),'PATH':'/usr/bin:/bin','LANG':'C','LC_ALL':'C'}
 cmd=[node,str(root/'suite.cjs'),str(source),group]
 t=time.monotonic();proc=subprocess.Popen(cmd,cwd=child,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,preexec_fn=limits)
 sel=selectors.DefaultSelector();sel.register(proc.stdout,selectors.EVENT_READ,'stdout');sel.register(proc.stderr,selectors.EVENT_READ,'stderr')
 output={'stdout':bytearray(),'stderr':bytearray()};killed=None
 while sel.get_map():
  cpu=resource.getrusage(resource.RUSAGE_CHILDREN)
  if not killed and (time.monotonic()-t>10 or time.monotonic()-start>60 or cpu.ru_utime+cpu.ru_stime>30):killed='time/cpu budget';proc.kill()
  for key,_ in sel.select(.05):
   data=os.read(key.fileobj.fileno(),65536)
   if not data:sel.unregister(key.fileobj);continue
   total+=len(data)
   if sum(map(len,output.values()))+len(data)>1048576 or total>4194304:
    if not killed:killed='output budget';proc.kill()
   else:output[key.data].extend(data)
 code=proc.wait();sel.close()
 for stream,data in output.items():(root/(group+'.'+stream+'.log')).write_bytes(data)
 result={'group':group,'cwd':str(child),'command':cmd,'env':env,'exit':code,'killed':killed,'elapsedSeconds':round(time.monotonic()-t,4),'bytes':sum(map(len,output.values()))}
 results.append(result);print(json.dumps(result),flush=True);print(output['stdout'].decode(),end='',flush=True);print(output['stderr'].decode(),end='',flush=True)
 if killed:break
cpu=resource.getrusage(resource.RUSAGE_CHILDREN)
report={'source':str(source),'sourceShaBefore':before,'sourceShaAfter':sha(),'results':results,'elapsedSeconds':time.monotonic()-start,'childrenCpuSeconds':cpu.ru_utime+cpu.ru_stime,'outputBytes':total,'allPassed':len(results)==4 and all(r['exit']==0 and not r['killed'] for r in results)}
(root/'results.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report),flush=True)
sys.exit(0 if report['allPassed'] else 1)
