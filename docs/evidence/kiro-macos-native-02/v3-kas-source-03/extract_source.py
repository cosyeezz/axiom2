#!/usr/bin/env python3
"""Bounded offline extraction of public KAS implementation, never execution."""
import ctypes as C
import hashlib,io,json,os,resource,tarfile,tempfile,time
from pathlib import Path,PurePosixPath
ROOT=Path(__file__).resolve().parent
PREFIX='node_modules/@kiro/agent/'
ENTRY=PREFIX+'dist/server/acp-server.js'
class InBuf(C.Structure):_fields_=[('src',C.c_void_p),('size',C.c_size_t),('pos',C.c_size_t)]
class OutBuf(C.Structure):_fields_=[('dst',C.c_void_p),('size',C.c_size_t),('pos',C.c_size_t)]
def api():
 z=C.CDLL('/opt/homebrew/opt/zstd/lib/libzstd.dylib')
 for name,args,ret in [('ZSTD_createDStream',[],C.c_void_p),('ZSTD_initDStream',[C.c_void_p],C.c_size_t),('ZSTD_DCtx_setParameter',[C.c_void_p,C.c_int,C.c_int],C.c_size_t),('ZSTD_decompressStream',[C.c_void_p,C.POINTER(OutBuf),C.POINTER(InBuf)],C.c_size_t),('ZSTD_isError',[C.c_size_t],C.c_uint),('ZSTD_freeDStream',[C.c_void_p],C.c_size_t)]:
  f=getattr(z,name);f.argtypes=args;f.restype=ret
 return z
class ZReader(io.RawIOBase):
 def __init__(self,f,compressed_bytes,deadline,decoded_cap=512*1024*1024):
  super().__init__();self.z=api();self.ctx=self.z.ZSTD_createDStream()
  if not self.ctx:raise RuntimeError('decoder-allocation')
  self.f=f;self.remaining=compressed_bytes;self.deadline=deadline;self.cap=decoded_cap;self.pending=b'';self.ib=InBuf(None,0,0);self.input=None;self.output=C.create_string_buffer(65536);self.eof=False;self.decoded=0;self.compressed_read=0;self.compressed_consumed=0;self.ch=hashlib.sha256();self.dh=hashlib.sha256()
  try:
   self.check(self.z.ZSTD_initDStream(self.ctx));self.check(self.z.ZSTD_DCtx_setParameter(self.ctx,100,24))
  except BaseException:self.z.ZSTD_freeDStream(self.ctx);self.ctx=None;raise
 def check(self,result):
  if self.z.ZSTD_isError(result):raise RuntimeError('zstd-error')
  return result
 def readable(self):return True
 def _pump(self):
  if time.monotonic()>self.deadline:raise RuntimeError('deadline')
  if self.ib.pos==self.ib.size and self.remaining:
   b=self.f.read(min(65536,self.remaining))
   if not b:raise RuntimeError('compressed-short-read')
   self.remaining-=len(b);self.compressed_read+=len(b);self.ch.update(b);self.input=C.create_string_buffer(b);self.ib=InBuf(C.addressof(self.input),len(b),0)
  before=self.ib.pos;ob=OutBuf(C.addressof(self.output),65536,0)
  result=self.check(self.z.ZSTD_decompressStream(self.ctx,C.byref(ob),C.byref(self.ib)));self.compressed_consumed+=self.ib.pos-before
  b=self.output.raw[:ob.pos];self.decoded+=len(b)
  if self.decoded>self.cap:raise RuntimeError('decoded-cap')
  self.dh.update(b)
  if result==0:
   if self.ib.pos!=self.ib.size or self.remaining:raise RuntimeError('trailing-compressed-data')
   self.eof=True
  elif not b and self.ib.pos==before:raise RuntimeError('compressed-truncated' if self.remaining==0 else 'decoder-no-progress')
  return b
 def read(self,n=-1):
  if n<0 or n>1048576:raise RuntimeError('unbounded-read')
  while len(self.pending)<n and not self.eof:self.pending+=self._pump()
  result=self.pending[:n];self.pending=self.pending[n:];return result
 def close(self):
  if getattr(self,'ctx',None):self.z.ZSTD_freeDStream(self.ctx);self.ctx=None
  super().close()
def safe_name(raw):
 if len(raw)>4096 or '\\' in raw or '\x00' in raw:raise RuntimeError('unsafe-name')
 p=PurePosixPath(raw)
 if p.is_absolute() or '..' in p.parts:raise RuntimeError('unsafe-name')
 return str(p)
def extract_tar(reader,dest,deadline,max_members=40000,max_files=4096,max_selected=64*1024*1024,max_file=8*1024*1024):
 selected=[];seen=set();members=0;total=0
 with tarfile.open(fileobj=reader,mode='r|') as tf:
  for member in tf:
   if time.monotonic()>deadline:raise RuntimeError('deadline')
   members+=1
   if members>max_members:raise RuntimeError('member-cap')
   name=safe_name(member.name)
   chosen=name in (ENTRY,PREFIX+'package.json',PREFIX+'dist/server/acp-server.externals.json')
   if not chosen or member.isdir():continue
   if not member.isfile() or member.issym() or member.islnk():raise RuntimeError('selected-nonregular')
   if name in seen:raise RuntimeError('duplicate-selected-path')
   if member.size<0 or member.size>max_file:raise RuntimeError('file-cap')
   total+=member.size
   if total>max_selected or len(selected)>=max_files:raise RuntimeError('selected-cap')
   seen.add(name);path=dest.joinpath(*PurePosixPath(name).parts);path.parent.mkdir(parents=True,exist_ok=True);h=hashlib.sha256();actual=0
   with tf.extractfile(member) as src,path.open('xb') as output:
    while True:
     if time.monotonic()>deadline:raise RuntimeError('deadline')
     b=src.read(65536)
     if not b:break
     actual+=len(b)
     if actual>member.size:raise RuntimeError('member-size')
     output.write(b);h.update(b)
   if actual!=member.size:raise RuntimeError('member-short-read')
   path.chmod(0o400);selected.append({'path':name,'bytes':actual,'sha256':h.hexdigest()})
  # tar end is not frame end: validate zstd checksum and exact compressed slice.
  while reader.read(65536):
   if time.monotonic()>deadline:raise RuntimeError('deadline')
 if not reader.eof:raise RuntimeError('frame-not-finished')
 return {'tarMembers':members,'selectedFiles':selected,'selectedBytes':total,'entryFound':ENTRY in seen}
def main():
 out=ROOT/'verification.json';started=ROOT/'RUN_STARTED.json'
 if out.exists() or started.exists():raise SystemExit('CreateNew gate')
 with started.open('x') as f:json.dump({'sourceSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},f)
 resource.setrlimit(resource.RLIMIT_CPU,(120,120));t0=time.monotonic();deadline=t0+170;dest=Path(tempfile.mkdtemp(prefix='kiro-mac-kas-source03-')).resolve();reader=None
 r={'schema':'kas-public-source-extraction-1','status':'failed','sourceSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'outputDirectory':str(dest),'assetFileOffset':290729622,'assetBytes':22001675,'modelRequests':0,'targetExecutions':0,'userSettingsReads':0,'userSettingsWrites':0,'authStorageReads':0}
 try:
  with Path('/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/kiro-mac-identity-rebind01-vni48j5_/kiro-cli-chat.macho').open('rb') as f:
   before=os.fstat(f.fileno());h=hashlib.sha256()
   for chunk in iter(lambda:f.read(1048576),b''):
    if time.monotonic()>deadline:raise RuntimeError('deadline')
    h.update(chunk)
   r['targetSha256']=h.hexdigest()
   if r['targetSha256']!='7f684ad558ea35de830086a6d44f3eff4835ce381b70c861f365c8842729b94f':raise RuntimeError('target-identity')
   f.seek(r['assetFileOffset']);reader=ZReader(f,r['assetBytes'],deadline);r.update(extract_tar(reader,dest,deadline,max_file=64*1024*1024,max_selected=128*1024*1024));after=os.fstat(f.fileno())
   r.update({'compressedBytesRead':reader.compressed_read,'compressedBytesConsumed':reader.compressed_consumed,'decompressedBytes':reader.decoded,'compressedSha256':reader.ch.hexdigest(),'decompressedSha256':reader.dh.hexdigest(),'frameEof':reader.eof,'targetFileStable':(before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns)})
   if not r['entryFound'] or not r['targetFileStable']:raise RuntimeError('final-gate')
   r['status']='extracted_public_source_only'
 except Exception as e:
  r['errorType']=type(e).__name__;r['errorCategory']=str(e) if type(e) is RuntimeError else 'unclassified-error-no-body-persisted'
 finally:
  if reader is not None:reader.close()
 r['elapsedSeconds']=round(time.monotonic()-t0,3);r['boundary']='Static shipped public code only; no execution/effective engine/server parity proof.'
 with out.open('x') as f:json.dump(r,f,indent=2);f.write('\n')
 print(json.dumps({k:v for k,v in r.items() if k!='selectedFiles'},indent=2))
 raise SystemExit(0 if r['status']=='extracted_public_source_only' else 1)
if __name__=='__main__':main()
