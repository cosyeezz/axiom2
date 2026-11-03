"""Compare only public identity-context metadata in RAM; never obtain CLI tokens.
One official whoami (15s/128KiB) and one local Axiom SDK storage read (10s/128KiB).
No network/model from Axiom; no login/config changes. Equality predicates only persist.
"""
import importlib.util,json,pathlib,re,tempfile
from urllib.parse import urlsplit
root=pathlib.Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('smoke',root/'official-sonnet-01.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
with (root/'official-identity-compare-01.claim').open('x') as f:f.write('consumed\n')
rpt={'case':'official-identity-compare-01','inferencePromptSent':False}
node='/Users/dane/.local/share/pi-node/node-v22.23.2-darwin-arm64/bin/node'
module=(root.parents[2]/'app/dist/server/model-account-storage.js').as_uri()
code='''import {homedir} from 'node:os';import {join} from 'node:path';
for(const k of ['AXIOM_EXECUTION_PROFILE','AXIOM_MODEL_ACCOUNT_BINDINGS','AXIOM_MODEL_MANAGED_ACCOUNTS','AXIOM_EXECUTION_INSTANCE','AXIOM_EXECUTION_GENERATION'])delete process.env[k];
try{const {readModelCredential}=await import(MODULE);const a=readModelCredential('kiro',join(homedir(),'.pi/agent/auth.json'));console.log(JSON.stringify({authMethod:a?.authMethod,authRegion:a?.authRegion,startUrl:a?.startUrl,profileArn:a?.profileArn}));}catch{process.exitCode=1;}'''.replace('MODULE',json.dumps(module))
try:
 with tempfile.TemporaryDirectory(prefix='kiro-identity-compare-') as cwd:
  r,b=m.run([node,'--input-type=module','-e',code],cwd);rpt['axiomMetadataRead']=r
  if r['exitCode']!=0 or r['failure'] or not r['groupClear']:raise RuntimeError()
  a=json.loads(b['out'])
  r,b=m.run([m.CLI,'whoami','--format','json'],cwd,seconds=15);rpt['officialMetadataRead']=r
  if r['exitCode']!=0 or r['failure'] or not r['groupClear']:raise RuntimeError()
  text=b['out'].decode('utf-8');text=re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',text)
  urls=set(x.rstrip('/') for x in re.findall(r'https://[^\s\"\'<>),}]+',text))
  arns=set(re.findall(r'arn:aws(?:-[a-z]+)?:[a-z0-9-]+:[a-z0-9-]+:[0-9]{12}:[a-zA-Z0-9_./-]+',text))
  regions=set(re.findall(r'(?i)region[\"\s:=]+([a-z]{2}(?:-[a-z]+)+-[0-9]+)',text))
  rpt.update({'axiomIdentityCenter':a.get('authMethod')=='identity-center','officialIdentityCenter':'IamIdentityCenter' in text or 'IAM Identity Center' in text,'issuerComparable':bool(a.get('startUrl')) and len(urls)==1,'issuerMatches':bool(a.get('startUrl')) and a['startUrl'].rstrip('/') in urls,'regionComparable':bool(a.get('authRegion')) and len(regions)==1,'regionMatches':bool(a.get('authRegion')) and a['authRegion'] in regions,'profileComparable':bool(a.get('profileArn')) and len(arns)==1,'profileMatches':bool(a.get('profileArn')) and a['profileArn'] in arns,'sameEndUserProven':False})
 rpt['temporaryDirectoryRemoved']=not pathlib.Path(cwd).exists()
except Exception as e:rpt['failureType']=type(e).__name__
with (root/'official-identity-compare-01.json').open('x') as f:json.dump(rpt,f,indent=2);f.write('\n')
print(json.dumps(rpt))
