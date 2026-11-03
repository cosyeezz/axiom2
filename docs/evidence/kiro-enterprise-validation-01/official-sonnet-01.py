import hashlib, json, os, pathlib, selectors, signal, subprocess, sys, tempfile, time
ROOT=pathlib.Path(__file__).resolve().parent
CLI='/Users/dane/.local/bin/kiro-cli'
MODEL='claude-sonnet-5.5'
AGENT='axiom-official-sonnet-01'

class Projection:
 def __init__(self):
  self.text=[];self.tools=0;self.ends=set();self.models=[];self.records=0;self.tags=set();self.known_errors=set()
 def consume(self,line):
  try:v=json.loads(line)
  except (ValueError,UnicodeError):return
  self.records+=1;self.visit(v)
 def visit(self,v,assistant=False):
  if isinstance(v,list):
   for x in v:self.visit(x,assistant)
  elif isinstance(v,dict):
   tag=v.get('sessionUpdate',v.get('type'))
   if isinstance(tag,str) and tag in {'agent_message_chunk','agent_thought_chunk','tool_call','tool_call_update','assistant','assistant_message','result','error','system','session_update','session_start','message','text'}:self.tags.add(tag)
   if tag in ('tool_call','tool_call_update') or v.get('method')=='session/request_permission':self.tools+=1
   assistant=assistant or tag in ('agent_message_chunk','assistant','assistant_message') or v.get('role')=='assistant'
   if assistant:
    for key in ('text','content'):
     if isinstance(v.get(key),str):self.text.append(v[key])
   for key in ('stopReason','stop_reason'):
    if v.get(key) in ('end_turn','max_tokens','cancelled','refusal','tool_use','stop'):self.ends.add(v[key])
   for key in ('currentModelId','selectedModelId'):
    if isinstance(v.get(key),str):self.models.append(v[key]==MODEL)
   for key in ('code','name'):
    if v.get(key) in ('AccessDeniedException','UnauthorizedException','ValidationException'):self.known_errors.add(v[key])
   for x in v.values():
    if isinstance(x,(dict,list)):self.visit(x,assistant)
 def result(self):
  return {'jsonRecords':self.records,'knownTags':sorted(self.tags),'answer703':''.join(self.text).strip()=='703','assistantTextBytes':len(''.join(self.text).encode()),'toolEvents':self.tools,'stopReasons':sorted(self.ends),'observedModelMatches':all(self.models) if self.models else None,'knownErrors':sorted(self.known_errors)}

def live_group(pgid):
 r=subprocess.run(['/bin/ps','-axo','pgid=,stat='],capture_output=True,timeout=2)
 if r.returncode:raise RuntimeError()
 return any(len(a:=line.split())>=2 and a[0]==str(pgid).encode() and not a[1].startswith(b'Z') for line in r.stdout.splitlines())

def run(argv,cwd,env=None,seconds=10,cap=131072,observe=False):
 p=None;streams={'out':bytearray(),'err':bytearray()};projection=Projection();pending=bytearray();r={'failure':None};sel=selectors.DefaultSelector()
 try:
  p=subprocess.Popen(argv,cwd=cwd,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
  for f,name in ((p.stdout,'out'),(p.stderr,'err')):sel.register(f,selectors.EVENT_READ,name)
  end=time.monotonic()+seconds
  while sel.get_map():
   if time.monotonic()>end:r['failure']='TIMEOUT';break
   for key,_ in sel.select(.05):
    b=os.read(key.fileobj.fileno(),4096)
    if not b:sel.unregister(key.fileobj);continue
    if sum(map(len,streams.values()))+len(b)>cap:r['failure']='OUTPUT_LIMIT';break
    streams[key.data].extend(b)
    if observe and key.data=='out':
     pending.extend(b)
     while b'\n' in pending:
      line,_,rest=pending.partition(b'\n');pending=bytearray(rest);projection.consume(line)
     if projection.tools:r['failure']='TOOL_EVENT';break
   if r['failure']:break
  if observe and pending:projection.consume(pending)
  if not r['failure']:
   try:p.wait(timeout=max(.05,end-time.monotonic()))
   except subprocess.TimeoutExpired:r['failure']='TIMEOUT'
 except Exception:r['failure']='LOCAL_OR_PROCESS'
 finally:
  sel.close()
  if p:
   try:
    if live_group(p.pid):
     try:os.killpg(p.pid,signal.SIGTERM)
     except ProcessLookupError:pass
     time.sleep(.15)
    if live_group(p.pid):
     try:os.killpg(p.pid,signal.SIGKILL)
     except ProcessLookupError:pass
    p.wait(timeout=2)
    r['groupClear']=not live_group(p.pid)
   except Exception:r['groupClear']=False
   r['exitCode']=p.poll()
   p.stdout.close();p.stderr.close()
  else:r['groupClear']=False;r['exitCode']=None
  r['stdoutBytes']=len(streams['out']);r['stderrBytes']=len(streams['err'])
  if observe:r.update(projection.result())
 return r,streams

def selftest():
 tests={}
 with tempfile.TemporaryDirectory(prefix='kiro-smoke-selftest-') as cwd:
  events=[{'params':{'update':{'sessionUpdate':'agent_message_chunk','content':{'type':'text','text':'703'}}}},{'result':{'stopReason':'end_turn','models':{'currentModelId':MODEL}}}]
  code='import json;events='+repr(events)+';[print(json.dumps(e)) for e in events]'
  r,_=run([sys.executable,'-c',code],cwd,observe=True)
  tests['success']=r['exitCode']==0 and r['answer703'] and r['stopReasons']==['end_turn'] and r['observedModelMatches'] and r['groupClear']
  r,_=run([sys.executable,'-c','import time;time.sleep(5)'],cwd,seconds=.15)
  tests['timeout']=r['failure']=='TIMEOUT' and r['groupClear']
  r,_=run([sys.executable,'-c','print("x"*8192)'],cwd,cap=4096)
  tests['limit']=r['failure']=='OUTPUT_LIMIT' and r['groupClear']
  r,_=run([sys.executable,'-c','print(\'{"sessionUpdate":"tool_call"}\')'],cwd,observe=True)
  tests['toolStop']=r['failure']=='TOOL_EVENT' and r['groupClear']
  r,_=run([sys.executable,'-c','import subprocess,time,sys;subprocess.Popen([sys.executable,"-c","import time;time.sleep(10)"]);time.sleep(10)'],cwd,seconds=.2)
  tests['descendantGroup']=r['failure']=='TIMEOUT' and r['groupClear']
  p=Projection();p.consume(b'{"type":"error","message":"UNSAFE_SECRET_SENTINEL","code":"NEW_UNKNOWN"}');p.consume(b'not-json UNSAFE_SECRET_SENTINEL')
  tests['unknownHidden']='UNSAFE_SECRET_SENTINEL' not in json.dumps(p.result()) and not p.result()['answer703']
  p=Projection();p.consume(b'{"role":"user","content":"703"}')
  tests['userNotAnswer']=not p.result()['answer703']
 out={'tests':tests,'passed':all(tests.values())};(ROOT/'official-sonnet-01-selftest.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out));return out['passed']

def main():
 if '--selftest' in sys.argv:return 0 if selftest() else 1
 with (ROOT/'official-sonnet-01.claim').open('x') as f:f.write('consumed\n')
 report={'case':'official-sonnet-01','requestedModel':MODEL,'loginProvider':'Google','sameAxiomAuthMethod':False,'chatLaunches':0,'physicalRequests':None,'passed':False}
 try:
  if not json.loads((ROOT/'official-sonnet-01-selftest.json').read_text())['passed']:raise RuntimeError()
  h=hashlib.sha256()
  with open(CLI,'rb') as f:
   for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
  report['cliSha256']=h.hexdigest()
  if h.hexdigest()!='b88fe85d0c847b55af6212017c140722ff84bf081f18bc7bdba5188ade2fa54e':report['failure']='CLI_IDENTITY_CHANGED';raise RuntimeError()
  hooks=pathlib.Path.home()/'.kiro/hooks'
  if hooks.exists() and any(p.is_file() for p in hooks.rglob('*')):report['failure']='GLOBAL_HOOKS_PRESENT';raise RuntimeError()
  with tempfile.TemporaryDirectory(prefix='kiro-sonnet-01-') as cwd:
   tmp=pathlib.Path(cwd)/'tmp';tmp.mkdir();env=dict(os.environ,TMPDIR=str(tmp))
   r,before=run([CLI,'settings','--format','json','list'],cwd,env)
   report['settingsPreflight']={**r,'jsonValid':False}
   if r['exitCode']!=0 or r['failure'] or not r['groupClear']:raise RuntimeError()
   before=json.loads(before['out']);report['settingsPreflight']['jsonValid']=True
   config={'name':AGENT,'description':'Bounded no-tool arithmetic verification','prompt':'Answer the arithmetic question directly with digits only. Do not use tools.','model':MODEL,'tools':[],'resources':[],'mcpServers':{},'includeMcpJson':False,'includePowers':False,'hooks':{},'permissions':{'rules':[{'capability':'all','match':['*'],'effect':'deny'}]}}
   path=pathlib.Path(cwd)/'.kiro/agents'/f'{AGENT}.json';path.parent.mkdir(parents=True);path.write_text(json.dumps(config))
   r,_=run([CLI,'agent','validate','--path',str(path)],cwd,env)
   report['agentValidation']=r
   if r['exitCode']!=0 or r['failure'] or not r['groupClear']:raise RuntimeError()
   report['chatLaunches']=1
   r,_=run([CLI,'chat','--v3','--no-interactive','--output-format','stream-json','--model',MODEL,'--agent',AGENT,'--trust-workspace','--trust-tools=','Compute 37 multiplied by 19. Reply with only the integer result. Do not call tools.'],cwd,env,seconds=60,observe=True)
   report['chat']=r
   after_r,after=run([CLI,'settings','--format','json','list'],cwd,env)
   report['settingsReadback']=after_r
   report['settingsUnchanged']=after_r['exitCode']==0 and not after_r['failure'] and after_r['groupClear'] and json.loads(after['out'])==before
   report['passed']=r['exitCode']==0 and not r['failure'] and r['groupClear'] and r['answer703'] and not r['toolEvents'] and bool(set(r['stopReasons'])&{'end_turn','stop'}) and r['observedModelMatches'] is not False and report['settingsUnchanged']
  report['temporaryDirectoryRemoved']=not pathlib.Path(cwd).exists()
 except Exception:report.setdefault('failure','PREFLIGHT_OR_LOCAL')
 with (ROOT/'official-sonnet-01.json').open('x') as f:json.dump(report,f,indent=2);f.write('\n')
 print(json.dumps(report));return 0 if report['passed'] else 1

if __name__=='__main__':sys.exit(main())
