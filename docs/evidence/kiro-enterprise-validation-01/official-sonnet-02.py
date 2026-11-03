import hashlib, importlib.util, json, os, pathlib, tempfile, sys
ROOT=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('official_smoke_functions',ROOT/'official-sonnet-01.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
CASE='official-sonnet-02';AGENT='axiom-official-sonnet-02'
with (ROOT/f'{CASE}.claim').open('x') as f:f.write('consumed\n')
rpt={'case':CASE,'requestedModel':m.MODEL,'loginProvider':'Google','sameAxiomAuthMethod':False,'chatLaunches':0,'physicalRequests':None,'passed':False}
cwd=None
try:
 if not json.loads((ROOT/'official-sonnet-01-selftest.json').read_text())['passed']:raise RuntimeError()
 rpt['helperSha256']=hashlib.sha256((ROOT/'official-sonnet-01.py').read_bytes()).hexdigest()
 h=hashlib.sha256()
 with open(m.CLI,'rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 rpt['cliSha256']=h.hexdigest()
 if h.hexdigest()!='b88fe85d0c847b55af6212017c140722ff84bf081f18bc7bdba5188ade2fa54e':rpt['failure']='CLI_IDENTITY_CHANGED';raise RuntimeError()
 hooks=pathlib.Path.home()/'.kiro/hooks'
 if hooks.exists() and any(p.is_file() for p in hooks.rglob('*')):rpt['failure']='GLOBAL_HOOKS_PRESENT';raise RuntimeError()
 with tempfile.TemporaryDirectory(prefix='kiro-sonnet-02-') as cwd:
  tmp=pathlib.Path(cwd)/'tmp';tmp.mkdir();env=dict(os.environ,TMPDIR=str(tmp))
  r,b=m.run([m.CLI,'settings','list','--format','json'],cwd,env)
  rpt['settingsPreflight']=r
  if r['exitCode']!=0 or r['failure'] or not r['groupClear']:raise RuntimeError()
  before=json.loads(b['out'])
  config={'name':AGENT,'description':'Bounded no-tool arithmetic verification','prompt':'Answer the arithmetic question directly with digits only. Do not use tools.','model':m.MODEL,'tools':[],'resources':[],'mcpServers':{},'includeMcpJson':False,'includePowers':False,'hooks':{},'permissions':{'rules':[{'capability':'all','match':['*'],'effect':'deny'}]}}
  path=pathlib.Path(cwd)/'.kiro/agents'/f'{AGENT}.json';path.parent.mkdir(parents=True);path.write_text(json.dumps(config))
  r,_=m.run([m.CLI,'agent','validate','--path',str(path)],cwd,env)
  rpt['agentValidation']=r
  if r['exitCode']!=0 or r['failure'] or not r['groupClear']:raise RuntimeError()
  rpt['chatLaunches']=1
  r,b=m.run([m.CLI,'chat','--v3','--no-interactive','--output-format','stream-json','--model',m.MODEL,'--agent',AGENT,'--trust-workspace','--trust-tools=','Compute 37 multiplied by 19. Reply with only the integer result. Do not call tools.'],cwd,env,seconds=60,observe=True)
  rpt['chat']=r
  # Finite error predicates only; no unknown message or arbitrary content is saved.
  joined=bytes(b['out'])+bytes(b['err'])
  rpt['diagnostics']={key:needle in joined for key,needle in {'accessDenied':b'AccessDeniedException','loginRequired':b'Please log in','unknownModel':b'Unknown model','invalidModel':b'Invalid model','invalidAgent':b'Invalid agent','workspaceTrustRequired':b'Trust this workspace','permissionDenied':b'Permission denied','modelExactIdPresent':m.MODEL.encode()}.items()}
  r2,b2=m.run([m.CLI,'settings','list','--format','json'],cwd,env)
  rpt['settingsReadback']=r2
  rpt['settingsUnchanged']=r2['exitCode']==0 and not r2['failure'] and r2['groupClear'] and json.loads(b2['out'])==before
  rpt['passed']=r['exitCode']==0 and not r['failure'] and r['groupClear'] and r['answer703'] and not r['toolEvents'] and bool(set(r['stopReasons'])&{'end_turn','stop'}) and r['observedModelMatches'] is not False and rpt['settingsUnchanged']
except Exception:rpt.setdefault('failure','PREFLIGHT_OR_LOCAL')
rpt['temporaryDirectoryRemoved']=cwd is None or not pathlib.Path(cwd).exists()
with (ROOT/f'{CASE}.json').open('x') as f:json.dump(rpt,f,indent=2);f.write('\n')
print(json.dumps(rpt));sys.exit(0 if rpt['passed'] else 1)
