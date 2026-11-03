#!/usr/bin/env python3
"""Isolate HOME default and conflicting _KIRO_HOME priority; only self-owned JSON."""
import hashlib,json,os,selectors,signal,subprocess,tempfile,time
from pathlib import Path
ROOT=Path(__file__).resolve().parent;OUT=ROOT/'verification.json'
if OUT.exists():raise SystemExit('CreateNew gate')
sha=lambda b:hashlib.sha256(b).hexdigest()
realHome=str(Path.home().resolve());rows=[]
for mode,engine in [('home-only','v3'),('override','v2')]:
 work=Path(tempfile.mkdtemp(prefix='kiro-v3-settings-path03-'+mode+'-')).resolve();home=work/'home';home.mkdir();basecfg=home/'.kiro/settings/cli.json';basecfg.parent.mkdir(parents=True);basecfg.write_text('{"chat.agentEngine":"v3"}\n');cfg=basecfg if mode=='home-only' else work/'overridden/settings/cli.json';cfg.parent.mkdir(parents=True,exist_ok=True)
 payload=(json.dumps({'chat.agentEngine':engine},separators=(',',':'))+'\n').encode();cfg.write_bytes(payload);cfg.chmod(0o444);basecfg.chmod(0o444)
 profile='(version 1) (allow default) (deny network*) (deny file-read* (subpath '+json.dumps(realHome)+')) (deny file-write* (require-not (subpath '+json.dumps(str(work))+'))) (deny file-write* (literal '+json.dumps(str(cfg))+') (literal '+json.dumps(str(basecfg))+')) (deny mach-lookup (global-name "com.apple.securityd") (global-name "com.apple.securityd.xpc"))'
 argv=['/usr/bin/sandbox-exec','-p',profile,'/usr/bin/arch','-arm64','/Applications/Kiro CLI.app/Contents/MacOS/kiro-cli','settings','chat.agentEngine','--format','json']
 env={'HOME':str(home),'PATH':'/usr/bin:/bin','TERM':'dumb','NO_COLOR':'1','TMPDIR':str(work)}
 if mode=='override':env['_KIRO_HOME']=str(cfg.parent.parent)
 t0=time.monotonic();p=subprocess.Popen(argv,cwd=work,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
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
 stdout=bytes(buf['stdout']);stderr=bytes(buf['stderr']);projection=None;shape=None
 if code==0 and reason is None and not stderr:
  try:
   val=json.loads(stdout)
   if type(val) is str and val in ['v1','v2','v3']:projection=val;shape='json-string'
   elif type(val) is dict and set(val)=={'chat.agentEngine'} and type(val['chat.agentEngine']) is str and val['chat.agentEngine'] in ['v1','v2','v3']:projection=val['chat.agentEngine'];shape='single-key-json-object'
  except (ValueError,UnicodeError):
   if stdout.strip() in [b'v1',b'v2',b'v3']:projection=stdout.strip().decode();shape='plaintext-enum'
 files=[]
 for item in work.rglob('*'):
  if item.is_file():files.append({'path':str(item.relative_to(work)),'bytes':item.stat().st_size})
 unchanged=cfg.read_bytes()==payload
 rows.append({'mode':mode,'inputEngine':engine,'homeFixture':str(basecfg),'homeFixtureUnchanged':basecfg.read_text()=='{"chat.agentEngine":"v3"}\n','fixture':str(cfg),'fixtureSha256Before':sha(payload),'fixtureSha256After':sha(cfg.read_bytes()),'fixtureUnchanged':unchanged,'fixtureWriteDenied':True,'sandbox':profile,'argvTail':argv[-7:],'_KIRO_HOME':env.get('_KIRO_HOME'),'cwd':str(work),'exitCode':code,'stopReason':reason,'elapsedSeconds':round(time.monotonic()-t0,3),'stdoutBytes':len(stdout),'stdoutSha256':sha(stdout),'stderrBytes':len(stderr),'stderrSha256':sha(stderr),'projection':projection,'outputShape':shape,'matchesKnownInput':code==0 and reason is None and not stderr and projection==engine and unchanged and basecfg.read_text()=='{"chat.agentEngine":"v3"}\n','selfOwnedFiles':files})
report={'schema':'kiro-settings-path-fixture-3','status':'passed_self_owned_path_contract' if all(r['matchesKnownInput'] for r in rows) else 'unresolved_self_owned_path_contract','sourceSha256':sha(Path(__file__).read_bytes()),'cases':rows,'getterExecutions':len(rows),'modelRequests':0,'userSettingsReads':0,'userSettingWrites':0,'networkDenied':True,'realHomeFileReadsDenied':True,'boundary':'Self-owned HOME default and _KIRO_HOME override only; not actual user state or effective engine.'}
with OUT.open('x') as f:json.dump(report,f,indent=2);f.write('\n')
print(json.dumps(report,indent=2));raise SystemExit(0 if report['status']=='passed_self_owned_path_contract' else 1)
