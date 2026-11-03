#!/usr/bin/env python3
"""Read one non-secret setting in an empty isolated HOME; never real user state."""
import hashlib,json,os,selectors,signal,subprocess,tempfile,time
from pathlib import Path
ROOT=Path(__file__).resolve().parent;OUT=ROOT/'verification.json'
if OUT.exists():raise SystemExit('CreateNew gate')
work=Path(tempfile.mkdtemp(prefix='kiro-v3-settings-empty01-'));realHome=str(Path.home())
profile='(version 1) (allow default) (deny network*) (deny file-write*) (deny file-read* (subpath '+json.dumps(realHome)+')) (deny mach-lookup (global-name "com.apple.securityd") (global-name "com.apple.securityd.xpc"))'
argv=['/usr/bin/sandbox-exec','-p',profile,'/usr/bin/arch','-arm64','/Applications/Kiro CLI.app/Contents/MacOS/kiro-cli','settings','chat.agentEngine','--format','json']
env={'HOME':str(work),'XDG_CONFIG_HOME':str(work),'XDG_DATA_HOME':str(work),'XDG_CACHE_HOME':str(work),'PATH':'/usr/bin:/bin','TERM':'dumb','NO_COLOR':'1','TMPDIR':str(work)}
before=sorted(str(p.relative_to(work)) for p in work.rglob('*'));t0=time.monotonic()
p=subprocess.Popen(argv,cwd=work,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
sel=selectors.DefaultSelector();buf={'stdout':bytearray(),'stderr':bytearray()};reason=None
for name,stream in [('stdout',p.stdout),('stderr',p.stderr)]:sel.register(stream,selectors.EVENT_READ,name)
try:
 while sel.get_map():
  if time.monotonic()-t0>15:reason='timeout';break
  for key,_ in sel.select(.1):
   chunk=os.read(key.fd,4096)
   if not chunk:sel.unregister(key.fileobj);key.fileobj.close();continue
   if sum(len(x) for x in buf.values())+len(chunk)>4096:reason='output-cap';break
   buf[key.data].extend(chunk)
  if reason:break
 if reason:
  try:os.killpg(p.pid,signal.SIGKILL)
  except ProcessLookupError:pass
 code=p.wait(timeout=3)
finally:
 sel.close()
 for stream in [p.stdout,p.stderr]:
  if not stream.closed:stream.close()
 if p.poll() is None:
  try:os.killpg(p.pid,signal.SIGKILL)
  except ProcessLookupError:pass
  p.wait(timeout=3)
stdout=bytes(buf['stdout']);stderr=bytes(buf['stderr']);projection=None;known=False
if code==0 and reason is None and len(stderr)==0:
 try:
  value=json.loads(stdout)
  if value is None or (type(value) is str and value in ['v1','v2','v3']):projection=value;known=True
  elif type(value) is dict and set(value)=={'chat.agentEngine'} and (value['chat.agentEngine'] is None or (type(value['chat.agentEngine']) is str and value['chat.agentEngine'] in ['v1','v2','v3'])):projection=value;known=True
 except (ValueError,UnicodeError):pass
unchanged=before==sorted(str(p.relative_to(work)) for p in work.rglob('*'))
report={'schema':'kiro-settings-empty-fixture-1','status':'passed_empty_read_only' if known and unchanged else 'unresolved_getter_contract','argv':argv,'cwd':str(work),'sourceSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'exitCode':code,'stopReason':reason,'elapsedSeconds':round(time.monotonic()-t0,3),'stdoutBytes':len(stdout),'stdoutSha256':hashlib.sha256(stdout).hexdigest(),'stderrBytes':len(stderr),'stderrSha256':hashlib.sha256(stderr).hexdigest(),'knownProjection':known,'projection':projection,'emptyHomeUnchanged':unchanged,'realHomeFileReadsDenied':True,'fileWritesDenied':True,'networkDenied':True,'targetGetterExecutions':1,'modelRequests':0,'userSettingReads':0,'settingWrites':0,'effectiveEngine':None,'boundary':'An empty HOME result is not actual user/default/effective state or complete settings schema proof. Unknown output is not persisted.'}
with OUT.open('x') as f:json.dump(report,f,indent=2);f.write('\n')
print(json.dumps(report,indent=2))
raise SystemExit(0 if report['status']=='passed_empty_read_only' else 1)
