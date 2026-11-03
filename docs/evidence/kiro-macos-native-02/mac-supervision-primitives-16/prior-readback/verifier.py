import ast,hashlib,json,os,re,resource,signal,stat,time
from pathlib import Path
from urllib.parse import urlsplit,unquote
resource.setrlimit(resource.RLIMIT_CPU,(15,15))
resource.setrlimit(resource.RLIMIT_FSIZE,(4194304,4194304))
signal.alarm(60)
t0=time.monotonic(); out=Path(__file__).parent; root=Path('/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02'); c=root/'mac-supervision-primitives-15'
checks=[]; inventory={}; cache={}
def check(name,ok,detail=None):
 checks.append({'name':name,'pass':bool(ok),'detail':detail})
def read(p):
 p=Path(p)
 if p in cache:return cache[p]
 assert p.is_relative_to(root),str(p)
 assert not p.is_symlink(),str(p)
 s=p.stat(); assert stat.S_ISREG(s.st_mode) and s.st_size<4194304
 b=p.read_bytes(); z=p.stat(); assert (s.st_size,s.st_mtime_ns,s.st_ctime_ns)==(z.st_size,z.st_mtime_ns,z.st_ctime_ns)
 inventory[str(p)]={'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'mode':format(stat.S_IMODE(s.st_mode),'04o')};cache[p]=b;return b
def pairs(xs):
 d={}
 for k,v in xs:
  if k in d:raise ValueError('duplicate JSON key '+k)
  d[k]=v
 return d
def load(p):return json.loads(read(p),object_pairs_hook=pairs,parse_constant=lambda x:(_ for _ in ()).throw(ValueError(x)))
def write(name,obj):
 b=(json.dumps(obj,indent=2,ensure_ascii=False)+'\n').encode() if not isinstance(obj,str) else obj.encode()
 assert len(b)<4194304 and sum(x.stat().st_size for x in out.rglob('*') if x.is_file())+len(b)<16777216
 (out/name).write_bytes(b)
auth=[root/'README.md',root/'mac-supervision-primitives-14/SUMMARY.md']+[c/x for x in ['EXPERIMENT.md','SUMMARY.md','locate_fixups.py','preserve_prior.py','preserve_tests.py']]
links=[]
for p in auth:
 b=read(p);s=b.decode('utf-8');bad=[i for i,l in enumerate(s.splitlines(),1) if l.rstrip(' \t')!=l]
 check('authored whitespace/finalLF '+str(p.relative_to(root)),not bad and b.endswith(b'\n') and not b.endswith(b'\n\n') and b'\r' not in b,{'trailingWhitespaceLines':bad,'bytes':len(b)})
 if p.suffix!='.md':continue
 # Inline links; reference definitions and autolinks separately checked below.
 targets=re.findall(r'!?\[[^\]\n]*\]\(([^)\n]+)\)',s)
 targets+=re.findall(r'^\s*\[[^\]]+\]:\s*(\S+)',s,re.M)
 for text in targets:
  u=text.strip().split()[0].strip('<>'); v=urlsplit(u)
  if v.scheme or v.netloc:links.append({'from':str(p),'url':u,'external':True});continue
  q=(p.parent/unquote(v.path)).resolve(); allowed=q.is_relative_to(root) or q==root.parent/'kiro-macos-native-01/FAILURE.md'
  ok=allowed and q.exists();links.append({'from':str(p),'url':u,'resolved':str(q),'scope':allowed,'exists':q.exists()})
  check('local link '+str(p.relative_to(root))+' -> '+u,ok)
 check('markdown no unhandled link syntax '+p.name,not re.search(r'<(?:\.?\.?/|file:)',s))
m=load(c/'tests-preservation.json');check('copies declared92/395360',m['fileCount']==92 and m['bytes']==395360 and len(m['copies'])==92)
seen=set();total=0
for row in m['copies']:
 p=c/row['destination']; assert p.is_relative_to(c/'test-reports')
 b=read(p);v=inventory[str(p)];total+=len(b)
 check('copied '+row['destination'],row['destination'] not in seen and v['bytes']==row['bytes'] and v['sha256']==row['sha256'] and v['mode']==row['mode']=='0400');seen.add(row['destination'])
check('copied total and complete destination set',total==395360 and seen=={str(p.relative_to(c)) for p in (c/'test-reports').rglob('*') if p.is_file()},total)
check('ten sealed declarations',len(m['sealedMainAndSource'])==10)
for row in m['sealedMainAndSource']:
 p=c/row['path'];read(p);v=inventory[str(p)]
 check('sealed '+row['path'],v['bytes']==row['bytes'] and v['sha256']==row['sha256'],v)
pre=load(c/'results/preflight.json');man=load(c/'results/manifest.json')
for k,v in pre.items():check('shared preflight '+k,k in man and man[k]==v,v)
check('manifest result fields only',set(man)-set(pre)=={'status','entryCount','bindCount','rebaseCount','targetReferences','localContext'})
check('actual format12 and roots',[(r['pointerFormat'],r['pageSize'],r['pageStarts']) for r in man['metadata']['records']]==[(12,16384,[0,8]),(12,16384,[24])])
check('2396=936+1460',man['entryCount']==2396 and man['bindCount']==936 and man['rebaseCount']==1460 and man['entryCount']==man['bindCount']+man['rebaseCount'])
check('empty target refs/localContext',man['targetReferences']==[] and man['localContext']==[])
check('fixups metadata',[(man['metadata'][k]) for k in ['fixupsOffset','fixupsBytes','importsCount','importsFormat','symbolsFormat']]==[540672,16624,636,1,0])
expected={'sourceSHA256':'7b636e967e77705d88aad9ad9ea9af627852d83686cd19ab4d94c6010cd67b09','helperSHA256':'d0fac58e32092abaf2208646ccfcd4c6427d43f1edb46d79744e28f631ba7608','uuid':'3FEC147A-7931-3FCD-BDB9-59C9A814779C','sliceOffset':622592,'sliceSHA256':'fe9a1562d360e15c86937153586ca8778ee72bd95de423415ec780ebde9c0102','targetWrapperVA':0x10000f60c,'schemaSHA256':'6a99a4be90303c12b92a5a397f7ed299a44fe68485208c3b8eb667e48fb2afff','schemaSource':'/Library/Developer/CommandLineTools/SDKs/MacOSX13.3.sdk/usr/include/mach-o/fixup-chains.h'}
for k,v in expected.items():check('declared binding '+k,man[k]==v)
check('retained schema hash',inventory[str(c/'results/fixup-chains-sdk13.h')]['sha256']==man['schemaSHA256'])
tree=ast.parse(read(c/'locate_fixups.py')); constants={}
for n in tree.body:
 if isinstance(n,ast.Assign) and len(n.targets)==1 and isinstance(n.targets[0],ast.Name) and isinstance(n.value,ast.Constant):constants[n.targets[0].id]=n.value.value
for a,b in [('SOURCE_SHA','sourceSHA256'),('HELPER_SHA','helperSHA256'),('EXPECTED_UUID','uuid'),('WRAPPER','targetWrapperVA')]:check('source literal binding '+a,constants[a]==man[b])
check('locator source SHA',inventory[str(c/'locate_fixups.py')]['sha256']==m['sourceSHA256']=='ef7b3d8bebf172b1363f8cea0217cc0e799b590ad9e75f3ba330061514934b68')
raw=read(c/'main.stdout');parsed=json.loads(raw,object_pairs_hook=pairs)
check('main raw exit0 stdout97 stderr0',read(c/'main.exit')==b'0\n' and len(raw)==97 and read(c/'main.stderr')==b'')
check('raw stdout matches manifest',parsed=={'status':man['status'],'entries':man['entryCount'],'targetReferences':man['targetReferences']} and raw==(json.dumps(parsed)+'\n').encode())
for group,n in [('original325',325),('focused-guards',63)]:
 p=c/'test-reports'/group;j=load(p/'results.json');rows=j['results'] if group=='original325' else j['rows'];passed=all(r['status']=='PASS' for r in rows) if group=='original325' else all(r['pass'] is True for r in rows)
 check('preserved '+group+' outcomes',len(rows)==n and j['passed']==n and j['failed']==0 and passed)
 check('preserved '+group+' exit0 stderr0',read(p/'exit-status.txt')==b'0\n' and read(p/'stderr.log')==b'')
 rawlines=read(p/'stdout.log').splitlines(); lines=[json.loads(l,object_pairs_hook=pairs) for l in rawlines[:n]]; extras=rawlines[n:]; check('preserved '+group+' raw suffix',(len(extras)==1 and json.loads(extras[0])['passed']==63 and json.loads(extras[0])['exit']==0) if group=='focused-guards' else (len(extras)==1 and extras[0].startswith(b'SUMMARY ') and json.loads(extras[0][8:])['passed']==325 and json.loads(extras[0][8:])['failed']==0),[x.decode() for x in extras])
 check('preserved '+group+' raw rows',lines[:n]==rows,{'rawLineCount':len(lines),'rows':n,'extraLines':[x.decode() for x in extras]})
 report=read(p/'REPORT.md').decode();check('preserved '+group+' report read',str(n) in report and ('exit 0' in report.lower()))
 if group=='focused-guards':
  fixtures=[r for r in rows if isinstance(r.get('detail'),dict) and 'sha256' in r['detail']];files=list((p/'fixtures').glob('*'))
  check('51fixturecalls 48unique inputs',len(fixtures)==51 and len({r['detail']['sha256'] for r in fixtures})==48 and len(files)==51,{'calls':len(fixtures),'unique':len({r['detail']['sha256'] for r in fixtures}),'files':len(files)})
check('counts explicitly nonadditive',m['coverageCountsNotAdditive'] is True and 'do not call this388 independent cases' in read(c/'SUMMARY.md').decode())
check('preservation no new runs',all(m[k]==0 for k in ['newTestRuns','newLocatorRuns','targetRuns','controlCalls','modelRequests']))
check('sealed inventory is hash-size binding not mode promise',all('mode' not in r for r in m['sealedMainAndSource']),{r['path']:inventory[str(c/r['path'])]['mode'] for r in m['sealedMainAndSource']}); write('checks.json',checks);write('links.json',links);write('input-SHA256.json',inventory)
fail=[x for x in checks if not x['pass']];summary={'checks':len(checks),'passed':len(checks)-len(fail),'failed':len(fail),'inputs':len(inventory),'inputBytes':sum(x['bytes'] for x in inventory.values()),'localLinks':sum(not x.get('external',False) for x in links),'elapsedSeconds':time.monotonic()-t0,'failures':fail};write('summary.json',summary)
report='# Independent new7 / new15 artifact-only audit\n\n'+json.dumps(summary,indent=2)+'\n\nCWD /Volumes/D_Work/axiom2. Commands and native verifier exit: commands.txt / verifier.exit; byte-original verifier stdout/stderr: verifier.stdout / verifier.stderr. Full named checks: checks.json; existence/scope-only links: links.json; all content-read input hashes: input-SHA256.json. No linked target contents read unless independently authorized artifacts/manifests. Initial verifier attempt exited1 due to treating original325 SUMMARY-prefixed stdout trailer as a JSON row; corrected own parser only; initial source/streams/exit preserved as attempt1-*. Attempt2 exited1: own verifier added unsupported mode0400 requirement to ten hash-only seals and unique-name requirement to original325 (whose names may repeat), and expected no focused stdout summary trailer. Corrected only these audit assumptions; attempt2 checks/source/streams/exit retained. Ten seals match hashes/sizes; seven existing files are mode0600, three result artifacts0400; seal manifest does not promise0400 for originals. All92 copies do promise and meet0400. No evidence/test changes. No old23 hashes, unchanged11–13/runtime/pure tests or main reruns; no snapshot/systembinary reads, repo execution/imports, shim/network/control. Only own temporary verifier executed; AST parse of locator only, no compile/exec. Limits CPU15/wall60/file4MiB/aggregate16MiB.\n\nPreserved reports and raw results reviewed, not rerun: original325 PASS/exit0; focused63 outcomes/51 fixture invocations/48 unique inputs, overlapping coverage, not388 independent cases. Declared source/helper/UUID/slice bindings cross-checked only, not fresh real-binary authentication. M3, runtime supervision and server/native parity remain unproved.\n\n## Full checks\n'+ '\n'.join(('PASS ' if x['pass'] else 'FAIL ')+x['name']+' '+json.dumps(x['detail'],ensure_ascii=False) for x in checks)+'\n'
write('REPORT.md',report);print(json.dumps(summary));raise SystemExit(1 if fail else 0)
