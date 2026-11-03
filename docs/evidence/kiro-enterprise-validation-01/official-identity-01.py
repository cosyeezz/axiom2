import json, os, pathlib, selectors, signal, subprocess, tempfile, time
root=pathlib.Path(__file__).resolve().parent
with (root/'official-identity-01.claim').open('x') as f: f.write('consumed\n')
report={'command':'whoami --format json','passed':False}
known_fields={'provider','kind','type','authMethod','auth_method','loginType','login_type','status','region','email','user','userId','user_id','username','startUrl','start_url','profileArn','profile_arn','identity','account','loggedIn','logged_in'}
known_values={'IdC','identity-center','iam-identity-center','iam_identity_center','SSO_OIDC','BuilderId','builder-id','builder_id','social','google','github','Google','GitHub','logged-in','logged-out','authenticated','unauthenticated'}
p=None
try:
 with tempfile.TemporaryDirectory(prefix='kiro-identity-') as cwd:
  p=subprocess.Popen(['/Users/dane/.local/bin/kiro-cli','whoami','--format','json'],cwd=cwd,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
  sel=selectors.DefaultSelector();sel.register(p.stdout,selectors.EVENT_READ,'out');sel.register(p.stderr,selectors.EVENT_READ,'err')
  data={'out':bytearray(),'err':bytearray()};deadline=time.monotonic()+15
  try:
   while sel.get_map():
    if time.monotonic()>deadline: raise TimeoutError()
    for key,_ in sel.select(.1):
     chunk=os.read(key.fileobj.fileno(),4096)
     if not chunk: sel.unregister(key.fileobj);continue
     if sum(map(len,data.values()))+len(chunk)>65536: raise BufferError()
     data[key.data].extend(chunk)
   report['exitCode']=p.wait(timeout=1)
  finally: sel.close()
  report['stdoutPresent']=bool(data['out']);report['stderrPresent']=bool(data['err'])
  try:
   value=json.loads(data['out']);report['jsonType']=type(value).__name__
   report['knownFields']={};report['knownEnums']=[]
   def visit(v,depth=0):
    if depth>4:return
    if isinstance(v,dict):
     for k,x in v.items():
      if k in known_fields:report['knownFields'][k]=type(x).__name__
      visit(x,depth+1)
    elif isinstance(v,list):
     for x in v[:32]:visit(x,depth+1)
    elif isinstance(v,str) and v in known_values:report['knownEnums'].append(v)
   visit(value);report['knownEnums']=sorted(set(report['knownEnums']));report['passed']=report['exitCode']==0 and isinstance(value,dict)
  except (ValueError,UnicodeError):report['failure']='NON_JSON'
except TimeoutError:report['failure']='TIMEOUT'
except BufferError:report['failure']='OUTPUT_LIMIT'
except Exception:report['failure']='LOCAL_OR_PROCESS'
finally:
 if p and p.poll() is None:
  try:os.killpg(p.pid,signal.SIGTERM);p.wait(timeout=1)
  except Exception:
   try:os.killpg(p.pid,signal.SIGKILL);p.wait(timeout=2)
   except Exception:report['cleanupFailed']=True
 report['processExited']=p is not None and p.poll() is not None
 report['passed']=report['passed'] and report['processExited'] and not report.get('cleanupFailed',False)
 with (root/'official-identity-01.json').open('x') as f:json.dump(report,f,indent=2);f.write('\n')
 print(json.dumps(report))
