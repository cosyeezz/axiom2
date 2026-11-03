#!/usr/bin/env python3
"""One isolated --help, not a setting write/get or model call."""
import hashlib
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import tempfile
import time
ROOT=Path(__file__).resolve().parent;OUT=ROOT/'verification.json'
if OUT.exists():raise SystemExit('CreateNew gate')
realHome=str(Path.home());work=tempfile.mkdtemp(prefix='kiro-v3-settings-help01-')
profile='(version 1) (allow default) (deny network*) (deny file-write*) (deny file-read* (subpath '+json.dumps(realHome)+')) (deny mach-lookup (global-name "com.apple.securityd") (global-name "com.apple.securityd.xpc"))'
argv=['/usr/bin/sandbox-exec','-p',profile,'/usr/bin/arch','-arm64','/Applications/Kiro CLI.app/Contents/MacOS/kiro-cli','settings','--help']
env={'HOME':work,'XDG_CONFIG_HOME':work,'XDG_DATA_HOME':work,'XDG_CACHE_HOME':work,'PATH':'/usr/bin:/bin','TERM':'dumb','NO_COLOR':'1','TMPDIR':work}
t0=time.monotonic();p=subprocess.Popen(argv,cwd=work,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
sel=selectors.DefaultSelector();buf={'stdout':bytearray(),'stderr':bytearray()};reason=None
for name,stream in [('stdout',p.stdout),('stderr',p.stderr)]:sel.register(stream,selectors.EVENT_READ,name)
try:
 while sel.get_map():
  if time.monotonic()-t0>15:reason='timeout';break
  for key,_ in sel.select(.1):
   chunk=os.read(key.fd,8192)
   if not chunk:sel.unregister(key.fileobj);key.fileobj.close();continue
   if sum(len(x) for x in buf.values())+len(chunk)>65536:reason='output-cap';break
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
stdout=bytes(buf['stdout']);stderr=bytes(buf['stderr']);s=stdout.decode('utf-8',errors='replace')
knownHelp=code==0 and not reason and 'Usage:' in s and 'settings' in s.lower() and len(stderr)==0
if knownHelp:
 with (ROOT/'settings-help.txt').open('x') as f:f.write(s)
report={'schema':'kiro-settings-help-1','status':'passed_isolated_help_only' if knownHelp else 'failed_help_gate','argv':argv,'cwd':work,'isolatedHome':True,'realHomeFileReadsDenied':True,'networkDenied':True,'fileWritesDenied':True,'exitCode':code,'stopReason':reason,'elapsedSeconds':round(time.monotonic()-t0,3),'stdoutBytes':len(stdout),'stdoutSha256':hashlib.sha256(stdout).hexdigest(),'stderrBytes':len(stderr),'stderrSha256':hashlib.sha256(stderr).hexdigest(),'knownHelpSaved':knownHelp,'sourceSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'modelRequests':0,'settingReads':0,'settingWrites':0,'userCredentialAccessRequested':False}
with OUT.open('x') as f:json.dump(report,f,indent=2);f.write('\n')
print(json.dumps(report,indent=2))
raise SystemExit(0 if knownHelp else 1)
