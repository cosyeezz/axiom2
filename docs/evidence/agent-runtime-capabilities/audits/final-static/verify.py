#!/usr/bin/env python3
"""Independent read-only snapshot/document checks; stdlib only; writes exclusively /tmp."""
from pathlib import Path
from collections import Counter,defaultdict
import json,hashlib,re,sys,traceback,datetime,urllib.parse
ROOT=Path('/Volumes/D_Work/axiom2'); OUT=Path('/tmp/axiom-runtime-final-static'); E=ROOT/'docs/evidence/agent-runtime-capabilities'
checks=[]; failures=[]; notes=[]
def check(name,actual,expected=True):
 ok=actual==expected; checks.append({'name':name,'ok':ok,'actual':actual,'expected':expected})
 if not ok: failures.append(name)
def sha(b):return hashlib.sha256(b).hexdigest()
def load(p):
 def pairs(xs):
  d={}
  for k,v in xs:
   if k in d:raise ValueError(f'duplicate JSON key {k}: {p}')
   d[k]=v
  return d
 return json.loads(p.read_text(),object_pairs_hook=pairs)
def count(xs,key):return dict(sorted(Counter(key(x) for x in xs).items()))
def uniq(xs):return sorted(set(xs))
def cells(line):return [x.strip().replace(r'\|','|') for x in re.split(r'(?<!\\)\|',line.strip())[1:-1]]
def rows(text):return [cells(x) for x in text.splitlines() if x.startswith('|') and not re.fullmatch(r'[\s|:\-]+',x)]
def section(text,start,end=None):
 s=text.split(start,1)[1];return s.split(end,1)[0] if end else s
def links(text):
 # Balanced inline destinations; Markdown in this scope does not use reference definitions.
 found=[]
 for m in re.finditer(r'!?\[[^\]\n]*\]\(',text):
  i=m.end();depth=1;j=i
  while j<len(text) and depth:
   if text[j]=='(' and (j==0 or text[j-1]!='\\'):depth+=1
   if text[j]==')' and (j==0 or text[j-1]!='\\'):depth-=1
   j+=1
  if depth==0:found.append((m.start(),text[i:j-1]))
 return found
def paths(cell,base):
 return [str((base/urllib.parse.unquote(u.split('#')[0])).resolve().relative_to(ROOT)) for _,u in links(cell)]
def esc(x):return str(x).replace('\n',' ')
def main():
 json_files=sorted(E.rglob('*.json'));parsed={str(p.relative_to(ROOT)):load(p) for p in json_files};check('all JSON parse without duplicate keys',len(parsed),len(json_files))
 inv=load(E/'pi-coupling-inventory.json');s=inv['summary'];ps=load(E/'pi-coupling-summary.json');cs=load(E/'capability-summary.json');m=load(E/'capability-matrix.json')
 check('inventory summary equals separate summary',s,ps)
 check('inventory top-level structure',set(inv),set(['summary','files','fileModes','sites','bindings','localEdges','unresolvedLocalEdges','parseDiagnostics','piReachableFiles']))
 check('matrix schema',m['schemaVersion'],1);check('matrix columns',m['columns'],['id','capability','owner','state','port','sources','semantics'])
 rr=[r for d in m['domains'] for r in d['rows']];check('151 rows',len(rr),151);check('14 domains',len(m['domains']),14)
 check('row widths',all(len(r)==7 for r in rr));check('nonempty string cells',all(isinstance(c,str) and c.strip() for r in rr for c in r))
 check('unique/sequential IDs',[r[0] for r in rr],[d['id']+str(i+1).zfill(2) for d in m['domains'] for i,r in enumerate(d['rows'])]);check('IDs unique',len(set(r[0] for r in rr)),151)
 check('owners valid',all(r[2] in m['owners'] for r in rr));check('states valid',all(r[3] in m['states'] for r in rr))
 check('domain counts',[len(d['rows']) for d in m['domains']],[10,8,11,10,10,12,8,12,11,14,17,10,10,8])
 owners=count(rr,lambda r:r[2]);states=count(rr,lambda r:r[3]);check('owners',owners,{'archive':23,'host':57,'model':17,'resources':14,'runtime':40});check('states',states,{'gap':2,'helper':1,'live':136,'new':4,'partial':8});check('owner/state sums',[sum(owners.values()),sum(states.values())],[151,151])
 byfile=defaultdict(list)
 def source(f):return 'app/src/'+f if f.startswith(('shared/','client/')) else 'app/src/server/'+f
 for r in rr:
  for f in r[5].split(','):byfile[source(f)].append(r[0])
 check('163 evidence source files',len(byfile),163);check('all evidence files exist',all((ROOT/f).is_file() for f in byfile))
 ff=inv['files'];sites=inv['sites'];bb=inv['bindings'];modes=inv['fileModes'];filepaths={f['path'] for f in ff}
 check('manifest file shape',all(set(f)=={'path','bytes','sha256','lines'} and isinstance(f['bytes'],int) and isinstance(f['lines'],int) and re.fullmatch('[0-9a-f]{64}',f['sha256']) for f in ff));check('600 unique manifest entries',len(filepaths),600);check('600 entries',len(ff),600);check('manifest excludes cache/third party',not any(set(Path(f).parts)&{'vite-cache','node_modules','.git'} for f in filepaths))
 manifest=sha(''.join(f"{f['path']}\0{f['sha256']}\n" for f in ff).encode());check('manifest hash reconstructed',manifest,s['sourceManifestHash']);check('manifest LOC sum',sum(f['lines'] for f in ff),64445);check('summary codeFiles/Lines',[s['codeFiles'],s['codeLines']],[len(ff),sum(f['lines'] for f in ff)])
 for area in ['server','client','shared']:
  group=[f for f in ff if f['path'].startswith('app/src/'+area+'/')]
  check('area manifest '+area,[len(group),sum(f['lines'] for f in group)],[s['scopeCounts'][area]['codeFiles'],s['scopeCounts'][area]['lines']])
 check('site IDs', [x['id'] for x in sites],list(range(1,128)));check('site count',len(sites),s['moduleSites']);check('site source membership',all(x['file'] in filepaths and x['line']>0 for x in sites));check('site package matches module',all(x['package']=='/'.join(x['module'].split('/')[:2]) for x in sites));check('site forms',count(sites,lambda x:x['form']),s['siteForms']);check('site modes',count(sites,lambda x:x['mode']),s['siteModes'])
 coupled=uniq(x['file'] for x in sites);check('94 direct files',len(coupled),94);check('all direct files classified',sorted(set(coupled)-set(byfile)),[]);check('fileModes unique',len(set(x['file'] for x in modes)),94);check('fileModes file set',sorted(x['file'] for x in modes),coupled)
 expected_modes=[]
 for f in coupled:
  ss=[x for x in sites if x['file']==f];t=any(x['mode']!='value' for x in ss);v=any(x['mode']!='type' for x in ss)
  expected_modes.append(dict(file=f,mode='mixed' if t and v else 'value-only' if v else 'type-only',sites=len(ss),packages=uniq(x['package'] for x in ss)))
 check('fileModes recomputed',modes,expected_modes);check('fileModes summary',count(modes,lambda x:x['mode']),s['fileModes']);check('binding count',len(bb),277);check('binding modes',count(bb,lambda b:b['mode']),s['bindingModes']);check('binding site/file integrity',all(1<=b['siteId']<=len(sites) and b['file']==sites[b['siteId']-1]['file'] and b['mode'] in ['type','value'] for b in bb));check('reference source/kind integrity',all(r['file']==b['file'] and r['kind'] in ['call','construct','type','value'] and r['line']>0 for b in bb for r in b['references']))
 symbol_groups=defaultdict(list)
 for b in bb:symbol_groups[(sites[b['siteId']-1]['package'],b['imported'])].append(b)
 check('100 unique package symbols',len(symbol_groups),100);check('symbols summary',len(symbol_groups),s['uniquePackageSymbols']);check('bindings summary',len(bb),s['importedBindings']);check('155 direct call/construct refs',sum(r['kind'] in ['call','construct'] for b in bb for r in b['references']),155);check('call count summary',s['directCallConstructReferences'],155)
 packs=[]
 for p in uniq(x['package'] for x in sites):
  ss=[x for x in sites if x['package']==p];bindings=[b for b in bb if sites[b['siteId']-1]['package']==p]
  packs.append(dict(package=p,files=len(set(x['file'] for x in ss)),sites=len(ss),bindings=len(bindings),uniqueSymbols=len(set(b['imported'] for b in bindings))))
 check('all per-package statistics',packs,s['packages']);check('package sum sites/bindings/symbols',[sum(p[k] for p in packs) for k in ['sites','bindings','uniqueSymbols']],[127,277,100])
 edges=inv['localEdges'];check('graph edge membership',all(e['file'] in filepaths and e['target'] in filepaths for e in edges));reachable=set(coupled)
 while True:
  extra={e['file'] for e in edges if e['target'] in reachable}-reachable
  if not extra:break
  reachable|=extra
 check('graph closure equals saved',sorted(reachable),inv['piReachableFiles']);check('graph summary',{ 'localEdges':len(edges),'unresolvedEdges':len(inv['unresolvedLocalEdges']),'piReachableFiles':len(reachable),'indirectlyReachableFiles':len(reachable)-len(coupled),'reachableByArea':count(reachable,lambda f:f.split('/')[2])},s['sourceImportGraph']);check('153/59 closure',[len(reachable),len(reachable-set(coupled))],[153,59]);check('parse diagnostics empty',inv['parseDiagnostics'],[]);check('parse diagnostic summary',s['parseDiagnosticCount'],0)
 check('private path counts',[len(s['privateModulePaths']),len(set(x['relativePath'] for x in s['privateModulePaths'])),len(set(x['file'] for x in s['privateModulePaths']))],[8,6,5]);check('borrowed/computed counts',[len(s['borrowedDependencies']),len(s['computedResolutionSites'])],[2,1])
 expected=dict(capabilityCount=len(rr),domains=[dict(id=d['id'],name=d['name'],count=len(d['rows'])) for d in m['domains']],owners=owners,states=states,evidenceFiles=len(byfile),directPiFiles=len(coupled),classifiedDirectPiFiles=len(set(coupled)&set(byfile)),uncoveredDirectPiFiles=sorted(set(coupled)-set(byfile)),sourceManifestHash=manifest,matrixSha256=sha((E/'capability-matrix.json').read_bytes()))
 for k,v in expected.items():check('capability summary '+k,cs[k],v)
 # Parse every generated matrix cell independently and compare semantic content and link targets.
 md=(E/'capability-matrix.md').read_text();mrows=[r for r in rows(md) if re.fullmatch('[A-Z][0-9]{2}',r[0])];check('generated matrix has all IDs', [r[0] for r in mrows],[r[0] for r in rr])
 for actual,r in zip(mrows,rr):
  check('matrix cells '+r[0],actual[:6],[r[0],esc(r[1]),m['owners'][r[2]],r[3],'`'+r[4]+'`',esc(r[6])]);check('matrix sources '+r[0],paths(actual[6],E),[source(f) for f in r[5].split(',')])
 check('matrix hashes present',manifest in md and cs['matrixSha256'] in md)
 app=(E/'pi-coupling-appendix.md').read_text();directrows=rows(section(app,'## 1.','## 2.'))[1:];check('appendix 94 rows',len(directrows),94)
 for a,f in zip(directrows,modes):
  check('appendix direct '+f['file'],[paths(a[0],E),a[1],int(a[2]),a[3].split('、'),a[4].split('、')],[[f['file']],f['mode'],f['sites'],[x.replace('@earendil-works/','') for x in f['packages']],byfile[f['file']]])
 symbol_section=section(app,'## 2.','## 3.');seen={};totals=[0,0,0,0]
 for part in symbol_section.split('### ')[1:]:
  p=part.split('（',1)[0];sr=rows(part)[1:]
  check('appendix package heading '+p,len(sr),next(x['uniqueSymbols'] for x in packs if x['package']==p))
  for a in sr:
   name=a[0].strip('`');key=(p,name);check('symbol not duplicated '+str(key),key not in seen);seen[key]=a
   bindings=symbol_groups.get(key,[]);numbers=[len(bindings),sum(b['mode']=='type' for b in bindings),sum(b['mode']=='value' for b in bindings),sum(r['kind'] in ['call','construct'] for b in bindings for r in b['references'])]
   check('symbol counts '+str(key),list(map(int,a[1:5])),numbers);check('symbol files '+str(key),paths(a[5],E),uniq(b['file'] for b in bindings));totals=[x+y for x,y in zip(totals,map(int,a[1:5]))]
 check('appendix symbol set equals snapshot',set(seen),set(symbol_groups));check('appendix symbol sums',totals,[277,165,112,155]);check('appendix hash/HEAD/version',all(x in app for x in [manifest,s['head'],s['piCodingAgentVersion']]))
 private=section(app,'## 3.','## 4.');pr=rows(private);data=[a for a in pr if a[0]!='来源'];wanted=s['privateModulePaths']+s['borrowedDependencies']+s['computedResolutionSites'];check('appendix supplementary rows',len(data),len(wanted))
 for a,x in zip(data,wanted):
  val=x.get('relativePath',x.get('dependency',x.get('expression'))).replace('`',"'")
  check('appendix supplementary '+x['file']+':'+str(x['line']),[paths(a[0],E),a[1]],[[x['file']],'`'+val+'`'])
 indirect=section(app,'## 4.');check('appendix indirect full set',paths(indirect,E),sorted(reachable-set(coupled)))
 # Main report table assertions: exact figures in relevant table rows, not blind numeric string search.
 main=(ROOT/'docs/agent-runtime-capability-inventory.md').read_text();mainrows=rows(main)
 def clean(c):return c.replace('**','').replace(',','')
 table={clean(a[0]):[clean(x) for x in a[1:]] for a in mainrows}
 for key,num in [('代码文件','600'),('代码文本行','64445'),('直接存在 Pi 字面量模块引用的文件','94'),('显式 type-only 文件','43'),('含非纯类型引用锚点的文件','51'),('Pi 字面量模块引用锚点','127'),('本地导入绑定','277'),('包内去重导入符号','100'),('导入绑定的直接call/construct语法引用','155'),('可解析语法图反向依赖闭包','153'),('私有JS相对路径','8处 / 6模块 / 5文件'),('计算式SDK版本resolve','1语法位置'),('借Pi安装目录加载第三方依赖','2处'),('人工矩阵涉及的源码文件','163')]:check('main metric '+key,table.get(key,['MISSING'])[0],num)
 for d in m['domains']:check('main domain '+d['id'],table.get(d['id']+' '+d['name'],['MISSING'])[0],str(len(d['rows'])))
 for k,n in states.items():check('main state '+k,table.get(k,['MISSING'])[0],str(n))
 for key,k in [('Runtime适配','runtime'),('原生存档适配','archive'),('资源配置适配','resources'),('独立模型网关','model'),('Axiom宿主保留','host')]:check('main owner '+k,table.get(key,['MISSING'])[0],str(owners[k]))
 for p in packs:check('main package '+p['package'],list(map(int,table[p['package'].split('/')[-1]][:4])),[p[k] for k in ['files','sites','bindings','uniqueSymbols']])
 check('main manifest hash exact',re.findall(r'manifest SHA256：`([a-f0-9]+)`',main),[manifest]);check('main HEAD/version',s['head'] in main and '**'+s['piCodingAgentVersion']+'**' in main)
 # Structural Markdown/link validation (all scoped MD; audits only checked as historical document links).
 md_files=[ROOT/'docs/agent-runtime-capability-inventory.md',ROOT/'docs/agent-runtime-adapter-contract.md']+sorted(E.rglob('*.md'));link_records=[];format_issues=[];historical=[]
 for p in md_files:
  text=p.read_text();fence=None;visible=[];tablewidth=None
  for lineno,line in enumerate(text.splitlines(),1):
   fm=re.match(r'^\s*(`{3,}|~{3,})',line)
   if fm:
    marker=fm[1]
    if fence is None:fence=marker
    elif marker[0]==fence[0] and len(marker)>=len(fence):fence=None
    visible.append('');tablewidth=None;continue
   if fence:visible.append('');continue
   visible.append(line)
   if re.match(r'^\s*(<{7}|={7}|>{7})(\s|$)',line):format_issues.append([str(p.relative_to(ROOT)),lineno,'merge marker'])
   if line.startswith('|'):
    width=len(cells(line))
    if tablewidth is None:tablewidth=width
    elif width!=tablewidth:format_issues.append([str(p.relative_to(ROOT)),lineno,f'table width {width}, expected {tablewidth}'])
   else:tablewidth=None
  if fence:format_issues.append([str(p.relative_to(ROOT)),len(text.splitlines()),'unclosed fence'])
  visible='\n'.join(visible)
  for pos,url in links(visible):
   url=url.strip().strip('<>');is_historical='audits' in p.parts
   if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:',url):continue
   target,_,frag=url.partition('#');target=urllib.parse.unquote(target);resolved=(p.parent/target).resolve() if target else p
   record=dict(file=str(p.relative_to(ROOT)),line=visible[:pos].count('\n')+1,target=url,exists=resolved.exists(),historical=is_historical)
   if frag and re.fullmatch(r'L\d+(?:-L?\d+)?',frag):
    # Historical line numbers are not required to track final snapshot. Nonhistorical line anchors are bounded only.
    if not is_historical and resolved.is_file():
     last=int(re.findall(r'\d+',frag)[-1]);record['anchorValid']=last<=len(resolved.read_text().splitlines())
   elif frag and resolved.suffix=='.md' and resolved.is_file():
    slugs=[];counts=Counter()
    for h in re.findall(r'^#{1,6}\s+(.+?)\s*#*$',resolved.read_text(),re.M):
     slug=re.sub(r'[^\w\-\s]','',h.replace('`','').lower(),flags=re.UNICODE).replace(' ','-');n=counts[slug];counts[slug]+=1;slugs.append(slug+('-'+str(n) if n else ''))
    record['anchorValid']=urllib.parse.unquote(frag) in slugs
   link_records.append(record)
   if is_historical and (not record['exists'] or not record.get('anchorValid',True)):historical.append(record)
 check('Markdown format checks',format_issues,[]);bad=[x for x in link_records if not x['historical'] and (not x['exists'] or not x.get('anchorValid',True))];check('nonhistorical local links and anchors',bad,[])
 # Snapshot-to-current-disk drift is observation, NOT a failed document/JSON assertion or renderer bug.
 drift=[]
 for f in ff:
  p=ROOT/f['path']
  if not p.is_file():drift.append(dict(file=f['path'],missing=True));continue
  b=p.read_bytes();h=sha(b)
  if h!=f['sha256']:drift.append(dict(file=f['path'],snapshotSha256=f['sha256'],currentSha256=h,snapshotBytes=f['bytes'],currentBytes=len(b),snapshotLines=f['lines'],currentLines=len(b.decode().splitlines()),matrixIDs=byfile.get(f['path'],[]),directPiFile=f['path'] in coupled))
 current=[]
 def walk(p):
  for x in p.iterdir():
   if x.is_dir():
    if x.name not in ['vite-cache','node_modules','.git']:walk(x)
   elif re.search(r'\.(?:[cm]?[jt]sx?)$',x.name):current.append(str(x.relative_to(ROOT)))
 walk(ROOT/'app/src');scope_delta=dict(added=sorted(set(current)-filepaths),removed=sorted(filepaths-set(current)))
 out=dict(timestamp=datetime.datetime.now(datetime.timezone.utc).isoformat(),checks=checks,failed=failures,sourceDrift=drift,scopeDelta=scope_delta,markdownFiles=len(md_files),localLinks=len(link_records),historicalLinkWarnings=historical,formatIssues=format_issues,localLinkDetails=link_records,summary=dict(capabilities=len(rr),domains=len(m['domains']),owners=owners,states=states,evidenceFiles=len(byfile),directFiles=len(coupled),symbols=len(symbol_groups),appendixSymbolTotals=totals,manifestHash=manifest,matrixHash=cs['matrixSha256']))
 (OUT/'results.json').write_text(json.dumps(out,ensure_ascii=False,indent=2,default=lambda x:sorted(x) if isinstance(x,set) else str(x))+'\n')
 print(json.dumps({k:v for k,v in out.items() if k not in ['checks','localLinkDetails']},ensure_ascii=False,indent=2,default=str));print(f'CHECKS: {len(checks)}, PASS: {len(checks)-len(failures)}, FAIL: {len(failures)}')
 return 1 if failures else 0
try:sys.exit(main())
except Exception:
 traceback.print_exc();sys.exit(2)
