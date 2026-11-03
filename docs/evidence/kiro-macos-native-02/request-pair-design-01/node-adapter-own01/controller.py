import os,sys,json,hashlib,subprocess,time,selectors
root=os.path.dirname(os.path.abspath(__file__))
source='/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02/request-pair-design-01'
node='/Users/dane/.local/share/pi-node/node-v22.23.2-darwin-arm64/bin/node'
files=['ADAPTER-CONTRACT.md','ADAPTER-SOURCE-BINDING.json','node_http_adapter.cjs','traffic_values.cjs']
def hashes():
 return {f:hashlib.sha256(open(source+'/'+f,'rb').read()).hexdigest() for f in files}
def save(n,v):
 with open(root+'/'+n,'x') as f:json.dump(v,f,indent=2);f.write('\n')
env={'HOME':root+'/home','TMPDIR':root+'/tmp','TMP':root+'/tmp','TEMP':root+'/tmp','PATH':'/usr/bin:/bin','LANG':'C','OWN':root,'SOURCE':source}
cmd=[node,root+'/harness.cjs']
cert=['/usr/bin/openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-keyout',root+'/key.pem','-out',root+'/cert.pem']
manifest={'sourceBefore':hashes(),'node':node,'command':cmd,'controllerCommand':['/usr/bin/python3',root+'/controller.py'],'certCommand':cert,'env':env,'maxNodeSeconds':15,'casesMax':12,'requestsMax':6,'pipeHardCapBytesEach':65536,'sourceReadBudgetBytes':65536,'scope':'own-loopback-only','harnessSha256':hashlib.sha256(open(root+'/harness.cjs','rb').read()).hexdigest()}
save('manifest.json',manifest)
t=time.monotonic()
c=subprocess.run(cert,env=env,cwd=root,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=12)
if c.returncode:save('result.json',{'certExit':c.returncode,'nodeExecuted':False});sys.exit(c.returncode)
p=subprocess.Popen(cmd,env=env,cwd=root,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
sel=selectors.DefaultSelector(); streams={'stdout':bytearray(),'stderr':bytearray()}; eof={'stdout':False,'stderr':False}
for name,s in [('stdout',p.stdout),('stderr',p.stderr)]:os.set_blocking(s.fileno(),False);sel.register(s,selectors.EVENT_READ,name)
deadline=time.monotonic()+15;timed=False;cap=False
while sel.get_map():
 if time.monotonic()>deadline and not timed:timed=True;p.kill()
 for key,_ in sel.select(0.05):
  name=key.data;b=os.read(key.fileobj.fileno(),4096)
  if not b:eof[name]=True;sel.unregister(key.fileobj);key.fileobj.close();continue
  if len(streams[name])+len(b)>65536:
   cap=True;p.kill()
  else:streams[name].extend(b)
code=p.wait(); worker=None;valid=False
try:
 w=json.loads(streams['stdout']); allowed={'version','platform','arch','cases','requests','passed','failed','httpPort','httpsPort','restores','timedOut','fatal'}
 valid=isinstance(w,dict) and set(w)<=allowed and all(type(v) in (int,bool,str) for v in w.values()) and w.get('version')=='v22.23.2' and w.get('platform')=='darwin' and w.get('arch')=='arm64'
 if valid:worker=w
except Exception:pass
after=hashes()
r={'heldPID':p.pid,'waitExit':code,'stdoutEOF':eof['stdout'],'stderrEOF':eof['stderr'],'stdoutBytes':len(streams['stdout']),'stderrBytes':len(streams['stderr']),'timedOut':timed,'pipeCapExceeded':cap,'workerValidated':valid,'worker':worker,'certExit':c.returncode,'sourceAfter':after,'sourceUnchanged':after==manifest['sourceBefore'],'elapsedSeconds':round(time.monotonic()-t,3),'toolNumericExit':'unknown'}
save('result.json',r)
print(json.dumps({'artifacts':root,'heldPID':p.pid,'waitExit':code,'workerValidated':valid,'sourceUnchanged':r['sourceUnchanged'],'stdoutEOF':eof['stdout'],'stderrEOF':eof['stderr'],'worker':worker}))
sys.exit(code if code else (0 if valid and not timed and not cap and not streams['stderr'] and r['sourceUnchanged'] else 3))
