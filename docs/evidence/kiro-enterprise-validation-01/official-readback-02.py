"""Fresh read-only post-login case: one whoami and one list-models, no prompt.
Normal official authentication only, no credential file access or proxy/TLS changes.
Each command <=20s/128KiB, raw output only RAM; fixed provider enums/public model IDs only.
"""
import importlib.util,json,pathlib,re,tempfile
root=pathlib.Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('smoke',root/'official-sonnet-01.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
with (root/'official-readback-02.claim').open('x') as f:f.write('consumed\n')
rpt={'case':'official-readback-02','inferencePromptSent':False,'passed':False}
providers={'Google','GitHub','Builder ID','AWS Builder ID','Identity Center','IAM Identity Center','AWS IAM Identity Center','IdC','BuilderId','identity-center','google','github'}
try:
 with tempfile.TemporaryDirectory(prefix='kiro-readback-02-') as cwd:
  r,b=m.run([m.CLI,'whoami','--format','json'],cwd,seconds=15)
  rpt['identity']=r
  if r['exitCode']!=0 or r['failure'] or not r['groupClear']:raise RuntimeError()
  v=json.loads(b['out']);rpt['provider']=v.get('provider') if v.get('provider') in providers else 'other'
  rpt['knownIdentityFields']=[k for k in ('provider','email','startUrl','start_url','region','profileArn','profile_arn') if k in v]
  r,b=m.run([m.CLI,'chat','--v3','--list-models','--format','json'],cwd,seconds=20)
  rpt['catalog']=r
  if r['exitCode']!=0 or r['failure'] or not r['groupClear']:raise RuntimeError()
  v=json.loads(b['out']);ids=set()
  def visit(x):
   if isinstance(x,dict):
    for a in x.values():visit(a)
   elif isinstance(x,list):
    for a in x:visit(a)
   elif isinstance(x,str) and (re.fullmatch(r'claude-(?:sonnet|opus|haiku)-[0-9][0-9a-z._-]{0,60}',x) or x=='deepseek-3.2'):ids.add(x)
  visit(v);rpt['publicModelIds']=sorted(ids);rpt['exactSonnet55Present']='claude-sonnet-5.5' in ids;rpt['exactOpus55Present']='claude-opus-5.5' in ids;rpt['passed']=True
 rpt['temporaryDirectoryRemoved']=not pathlib.Path(cwd).exists()
except Exception:rpt['failure']='LOCAL_OR_SCHEMA'
with (root/'official-readback-02.json').open('x') as f:json.dump(rpt,f,indent=2);f.write('\n')
print(json.dumps(rpt))
