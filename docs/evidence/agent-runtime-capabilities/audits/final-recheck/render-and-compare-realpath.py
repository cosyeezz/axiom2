#!/usr/bin/env python3
"""Run unmodified renderer to isolated temp; normalize only Markdown link destinations."""
from pathlib import Path
import json,subprocess,hashlib,re,datetime,sys,difflib
ROOT=Path('/Volumes/D_Work/axiom2');OUT=Path('/tmp/axiom-runtime-final-recheck');E=ROOT/'docs/evidence/agent-runtime-capabilities';TARGET=(OUT/'rendered-realpath').resolve()
checks=[]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def check(name,actual,expected):checks.append(dict(name=name,ok=actual==expected,actual=actual,expected=expected))
def normalized(p):
 text=p.read_text()
 def replace(m):
  url=m[1];f,sep,frag=url.partition('#');absolute=(p.parent/f).resolve() if f else p.resolve()
  try:canon='repo:/'+str(absolute.relative_to(ROOT))
  except ValueError:canon='absolute:'+str(absolute)
  return ']('+canon+(sep+frag if sep else '')+')'
 return re.sub(r'\]\(([^)\n]+)\)',replace,text)
scoped=[ROOT/'docs/agent-runtime-capability-inventory.md',ROOT/'docs/agent-runtime-adapter-contract.md']+sorted(p for p in E.rglob('*') if p.is_file())
before={str(p.relative_to(ROOT)):sha(p) for p in scoped}
cmd=['node','docs/evidence/agent-runtime-capabilities/render-capability-inventory.mjs',str(TARGET)]
p=subprocess.run(cmd,cwd=ROOT,text=True,capture_output=True)
(OUT/'04.stdout.log').write_text(p.stdout);(OUT/'04.stderr.log').write_text(p.stderr);(OUT/'04.exit').write_text(str(p.returncode)+'\n')
records=[dict(command=['python3',str(OUT/'verify.py')],cwd=str(ROOT),exit=int((OUT/'01.exit').read_text()),stdout='01.stdout.log',stderr='01.stderr.log'),dict(command=cmd,cwd=str(ROOT),exit=p.returncode,stdout='04.stdout.log',stderr='04.stderr.log')]
previous=json.loads((OUT/'commands.json').read_text()); previous.append(records[-1]); (OUT/'commands.json').write_text(json.dumps(previous,indent=2)+'\n')
check('renderer actual exit',p.returncode,0)
if p.returncode==0:
 check('generated output filenames',sorted(x.name for x in TARGET.iterdir()),['capability-matrix.md','capability-summary.json','pi-coupling-appendix.md'])
 for name in ['capability-summary.json']:
  actual=json.loads((TARGET/name).read_text());expected=json.loads((E/name).read_text());check('summary deep JSON equality',actual,expected);check('summary byte equality',sha(TARGET/name),sha(E/name));check('renderer stdout equals summary',json.loads(p.stdout),expected)
 for name in ['capability-matrix.md','pi-coupling-appendix.md']:
  actual=normalized(TARGET/name);expected=normalized(E/name)
  (OUT/(name+'.realpath.rendered.normalized')).write_text(actual);(OUT/(name+'.realpath.saved.normalized')).write_text(expected)
  difference=''.join(difflib.unified_diff(expected.splitlines(True),actual.splitlines(True),fromfile='saved/'+name,tofile='rendered/'+name))
  (OUT/(name+'.realpath.diff')).write_text(difference)
  check(name+' normalized full-text equality',actual==expected,True)
  check(name+' normalized SHA256',hashlib.sha256(actual.encode()).hexdigest(),hashlib.sha256(expected.encode()).hexdigest())
  alltargets=[]
  for match in re.finditer(r'\]\(([^)\n]+)\)',(TARGET/name).read_text()):
   file=match[1].split('#')[0]
   alltargets.append((TARGET/file).resolve().exists())
  check(name+' generated local link targets exist',all(alltargets),True)
  checks.append(dict(name=name+' local link occurrence count',ok=True,actual=len(alltargets)))
after={str(p.relative_to(ROOT)):sha(p) for p in scoped}
check('all scoped repository artifacts unchanged during renderer/compare',after,before)
(OUT/'reviewed-artifact-hashes.json').write_text(json.dumps(after,ensure_ascii=False,indent=2)+'\n')
result=dict(timestamp=datetime.datetime.now(datetime.timezone.utc).isoformat(),checks=checks,failed=[x['name'] for x in checks if not x['ok']],rendererExit=p.returncode)
(OUT/'reproduction-results-realpath.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(dict(timestamp=result['timestamp'],checkCount=len(checks),failed=result['failed'],rendererExit=p.returncode),ensure_ascii=False,indent=2))
sys.exit(1 if result['failed'] else 0)
