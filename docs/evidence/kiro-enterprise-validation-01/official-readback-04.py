"""Metadata-only recovery: support plain/ANSI-wrapped identity output as well as JSON.
One whoami + one catalogue; no prompt, credential file access, or network setting changes.
Each <=20s/128KiB. All raw output RAM; public enum/pattern projections only.
"""
import importlib.util,json,pathlib,re,tempfile
root=pathlib.Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('smoke',root/'official-sonnet-01.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
with (root/'official-readback-04.claim').open('x') as f:f.write('consumed\n')
rpt={'case':'official-readback-04','inferencePromptSent':False}
def inspect(raw,identity):
 text=raw.decode('utf-8',errors='replace');clean=re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',text);d={}
 try:
  v=json.loads(clean);d['jsonType']=type(v).__name__
  if isinstance(v,dict):d['hasProviderField']='provider' in v
 except Exception as e:d['jsonFailureType']=type(e).__name__
 if identity:
  d['knownTextPredicates']={name:needle in clean for name,needle in {'iamIdentityCenter':'IAM Identity Center','identityCenter':'Identity Center','iamIdentityCenterEnum':'IamIdentityCenter','identityCenterEnum':'IdentityCenter','google':'Google','github':'GitHub','builderId':'Builder ID','loggedInWith':'Logged in with','startUrlLabel':'Start URL','profileLabel':'Profile','jsonProviderKey':'"provider"'}.items()}
 else:
  d['publicModelIds']=sorted(set(re.findall(r'\bclaude-(?:sonnet|opus|haiku)-[0-9][0-9a-z._-]{0,60}\b|\bdeepseek-3\.2\b',clean)))
  d['exactSonnet55Present']='claude-sonnet-5.5' in d['publicModelIds'];d['exactOpus55Present']='claude-opus-5.5' in d['publicModelIds']
 return d
try:
 with tempfile.TemporaryDirectory(prefix='kiro-readback-04-') as cwd:
  for key,args in [('identity',['whoami','--format','json']),('catalog',['chat','--v3','--list-models','--format','json'])]:
   r,b=m.run([m.CLI]+args,cwd,seconds=20);rpt[key]=r
   if r['exitCode']!=0 or r['failure'] or not r['groupClear']:break
   rpt[key].update(inspect(b['out'],key=='identity'))
 rpt['temporaryDirectoryRemoved']=not pathlib.Path(cwd).exists()
except Exception as e:rpt['failureType']=type(e).__name__
with (root/'official-readback-04.json').open('x') as f:json.dump(rpt,f,indent=2);f.write('\n')
print(json.dumps(rpt))
