import ctypes as C,hashlib,importlib.util,io,json,os,stat,sys,tarfile,time
from pathlib import Path
ROOT=Path(sys.argv[1]);SOURCE=Path('/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02/v3-kas-source-02/extract_source.py')
initial=hashlib.sha256(SOURCE.read_bytes()).hexdigest()
# AST comparison precedes import and all test execution.
import ast,copy
old_source=SOURCE.parent.parent/'v3-kas-source-01'/'extract_source.py'
old_bytes=old_source.read_bytes();new_bytes=SOURCE.read_bytes()
a=ast.parse(old_bytes);b=ast.parse(new_bytes)
def dump(node):return ast.dump(node,include_attributes=False)
def top(tree,name):return next(n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.ClassDef)) and n.name==name)
unchanged=['InBuf','OutBuf','api','ZReader','safe_name']
for name in unchanged:assert dump(top(a,name))==dump(top(b,name)),name
# The only extract_tar AST difference must be the exact selector.
x=copy.deepcopy(top(b,'extract_tar'));old_x=top(a,'extract_tar')
chosen_old=next(n for n in ast.walk(old_x) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='chosen' for t in n.targets))
chosen_new=next(n for n in ast.walk(x) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='chosen' for t in n.targets))
expected=ast.parse("chosen=name in (ENTRY,PREFIX+'package.json',PREFIX+'dist/server/acp-server.externals.json')").body[0]
assert dump(chosen_new)==dump(expected)
chosen_new.value=copy.deepcopy(chosen_old.value)
assert dump(x)==dump(old_x)
main=top(b,'main')
call=next(n for n in ast.walk(main) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='extract_tar')
assert len(call.keywords)==2
expected_budgets={'max_file':ast.parse('64*1024*1024',mode='eval').body,'max_selected':ast.parse('128*1024*1024',mode='eval').body}
assert {k.arg:dump(k.value) for k in call.keywords}=={k:dump(v) for k,v in expected_budgets.items()}
# Normalize exactly those approved differences; entire module AST must then match.
normalized=copy.deepcopy(b)
nx=top(normalized,'extract_tar')
next(n for n in ast.walk(nx) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='chosen' for t in n.targets)).value=copy.deepcopy(chosen_old.value)
nm=top(normalized,'main')
next(n for n in ast.walk(nm) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='extract_tar').keywords=[]
prefix_nodes=[n for n in ast.walk(nm) if isinstance(n,ast.Constant) and n.value=='kiro-mac-kas-source02-']
assert len(prefix_nodes)==1;prefix_nodes[0].value='kiro-mac-kas-source01-'
assert dump(normalized)==dump(a),'unexpected module AST delta'
ast_report={'unchangedDefinitions':unchanged,'extractTarOnlySelectorChanged':True,'wholeModuleOnlyApprovedChanges':True,'mainBudgetBytes':{'max_file':67108864,'max_selected':134217728},'oldSourceSha256':hashlib.sha256(old_bytes).hexdigest(),'newSourceSha256':initial}
(ROOT/'ast-comparison.json').write_text(json.dumps(ast_report,indent=2)+'\n')
print('AST comparison PASS before import',flush=True)
spec=importlib.util.spec_from_file_location('frozen_extract',SOURCE);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
results=[];generated=0
class Reader(io.BytesIO):
 @property
 def eof(self):return self.tell()==len(self.getbuffer())
def archive(items):
 global generated
 b=io.BytesIO()
 with tarfile.open(fileobj=b,mode='w',format=tarfile.PAX_FORMAT) as t:
  for name,data,kind in items:
   info=tarfile.TarInfo('placeholder');info.pax_headers={'path':name};info.mode=0o777
   info.type=kind;info.size=len(data) if kind==tarfile.REGTYPE else 0
   if kind in (tarfile.SYMTYPE,tarfile.LNKTYPE):info.linkname='../../escape'
   t.addfile(info,io.BytesIO(data) if info.size else None)
 out=b.getvalue();generated+=len(out);assert generated<=2*1024*1024
 return out
def files(dest):return {p.relative_to(dest).as_posix():p for p in dest.rglob('*') if p.is_file()}
def run(name,blob,expected=None,kwargs=None,zmode=None):
 dest=ROOT/name;dest.mkdir()
 reader=Reader(blob) if zmode is None else m.ZReader(io.BytesIO(blob),len(blob),time.monotonic()+10,**zmode)
 try:
  try:result=m.extract_tar(reader,dest,time.monotonic()+10,**(kwargs or {}))
  except RuntimeError as e:
   if str(e)!=expected:raise AssertionError((name,'unexpected rejection',str(e),expected))
   results.append({'case':name,'result':'PASS','rejection':str(e)})
   return None,dest
  if expected is not None:raise AssertionError((name,'ACCEPTED',expected))
  results.append({'case':name,'result':'PASS'})
  return result,dest
 finally:reader.close()
P=m.PREFIX;E=m.ENTRY;M=P+'package.json'
entry=b'// synthetic only\n\x00\xff\n';manifest=b'{"name":"synthetic"}\n'
normal=archive([(E,entry,tarfile.REGTYPE),(M,manifest,tarfile.REGTYPE),('unselected/never-written.js',b'not extracted',tarfile.REGTYPE),(P+'dist/empty',b'',tarfile.DIRTYPE)])
r,d=run('normal-pax',normal)
assert r['entryFound'] and r['tarMembers']==4 and r['selectedBytes']==len(entry)+len(manifest)
assert set(files(d))=={E,M}
assert r['selectedFiles']==[{'path':n,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()} for n,b in [(E,entry),(M,manifest)]]
for n,b in [(E,entry),(M,manifest)]:
 p=files(d)[n];assert p.read_bytes()==b and stat.S_IMODE(p.stat().st_mode)==0o400
for case,name in [('absolute','/synthetic-escape'),('parent','../synthetic-escape'),('embedded-parent',P+'dist/../escape'),('backslash',P+'dist/evil\\escape'),('nul',P+'dist/evil\x00escape')]:
 _,d=run(case,archive([(name,b'x',tarfile.REGTYPE)]),'unsafe-name');assert not files(d)
for case,kind in [('symlink',tarfile.SYMTYPE),('hardlink',tarfile.LNKTYPE)]:
 _,d=run(case,archive([(E,b'',kind)]),'selected-nonregular');assert not files(d)
run('duplicate',archive([(E,b'a',tarfile.REGTYPE),(E,b'b',tarfile.REGTYPE)]),'duplicate-selected-path')
run('file-cap',archive([(E,b'ab',tarfile.REGTYPE)]),'file-cap',{'max_file':1})
run('member-cap',normal,'member-cap',{'max_members':1})
run('selected-byte-cap',archive([(E,b'a',tarfile.REGTYPE),(M,b'b',tarfile.REGTYPE)]),'selected-cap',{'max_selected':1})
run('selected-count-cap',archive([(E,b'a',tarfile.REGTYPE),(M,b'b',tarfile.REGTYPE)]),'selected-cap',{'max_files':1})
# Exact cap boundaries are accepted, not merely oversized inputs rejected.
run('exact-caps',archive([(E,b'a',tarfile.REGTYPE)]),kwargs={'max_file':1,'max_selected':1,'max_files':1,'max_members':1})
z=m.api();z.ZSTD_compressBound.argtypes=[C.c_size_t];z.ZSTD_compressBound.restype=C.c_size_t
z.ZSTD_compress.argtypes=[C.c_void_p,C.c_size_t,C.c_void_p,C.c_size_t,C.c_int];z.ZSTD_compress.restype=C.c_size_t
bound=z.ZSTD_compressBound(len(normal));assert not z.ZSTD_isError(bound)
src=C.create_string_buffer(normal);dst=C.create_string_buffer(bound)
n=z.ZSTD_compress(dst,bound,src,len(normal),1);assert not z.ZSTD_isError(n)
compressed=dst.raw[:n];generated+=len(compressed);assert generated<=2*1024*1024
r,d=run('zstd-complete',compressed,zmode={});assert r['entryFound'] and files(d)[E].read_bytes()==entry
# Check decoder counters and hashes on an independent single bounded read.
with m.ZReader(io.BytesIO(compressed),len(compressed),time.monotonic()+10) as reader:
 decoded=reader.read(len(normal)+1)
 assert decoded==normal and reader.eof and reader.compressed_read==reader.compressed_consumed==len(compressed)
 assert reader.ch.hexdigest()==hashlib.sha256(compressed).hexdigest() and reader.dh.hexdigest()==hashlib.sha256(normal).hexdigest()
results.append({'case':'zstd-hashes-eof-counters','result':'PASS'})
run('zstd-truncated',compressed[:-1],'compressed-truncated',zmode={})
run('zstd-decoded-cap',compressed,'decoded-cap',zmode={'decoded_cap':len(normal)-1})
run('zstd-trailing',compressed+b'x','trailing-compressed-data',zmode={})
# Additional selector-only regression cases, with exact output bytes/SHA/mode.
X=P+'dist/server/acp-server.externals.json'
ignored=[P+'dist/unrelated.js',P+'dist/server/acp-server.js.map',P+'dist/server/acp-server.externals.json.map',P+'dist/server/acp-server.js.extra',P+'dist/server/nested/acp-server.js']
_,d=run('dist-unrelated-js-map-not-written',archive([(n,b'synthetic ignored',tarfile.REGTYPE) for n in ignored]))
assert not files(d)
content=[(E,entry),(M,manifest),(X,b'{"syntheticExternal":true}\n')]
blob=archive([(n,b,tarfile.REGTYPE) for n,b in content]+[(n,b'ignored',tarfile.REGTYPE) for n in ignored])
r,d=run('exact-three-whitelist',blob)
assert set(files(d))=={n for n,_ in content} and r['tarMembers']==len(content)+len(ignored)
assert r['selectedFiles']==[{'path':n,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()} for n,b in content]
assert r['selectedBytes']==sum(len(b) for _,b in content)
for n,b in content:
 assert files(d)[n].read_bytes()==b and stat.S_IMODE(files(d)[n].stat().st_mode)==0o400
assert hashlib.sha256(old_source.read_bytes()).hexdigest()==ast_report['oldSourceSha256']

final=hashlib.sha256(SOURCE.read_bytes()).hexdigest();assert final==initial
report={'source':str(SOURCE),'sourceSha256':initial,'sourceUnchanged':True,'cases':results,'passed':len(results),'syntheticGeneratedBytes':generated,'compressedBytes':len(compressed),'officialTargetOpened':False,'mainCalled':False,'astComparison':ast_report,'reusedHarnessCasesExecuted':19,'additionalSelectorCasesExecuted':2}
(ROOT/'results.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
