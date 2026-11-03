import ctypes as C,hashlib,importlib.util,io,json,os,stat,sys,tarfile,time
from pathlib import Path
ROOT=Path(sys.argv[1]);SOURCE=Path('/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02/v3-kas-source-01/extract_source.py')
initial=hashlib.sha256(SOURCE.read_bytes()).hexdigest()
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
final=hashlib.sha256(SOURCE.read_bytes()).hexdigest();assert final==initial
report={'source':str(SOURCE),'sourceSha256':initial,'sourceUnchanged':True,'cases':results,'passed':len(results),'syntheticGeneratedBytes':generated,'compressedBytes':len(compressed),'officialTargetOpened':False,'mainCalled':False}
(ROOT/'results.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
