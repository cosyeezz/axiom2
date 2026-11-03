import os, sys, struct, hashlib, json, importlib.util, resource, time
from pathlib import Path
resource.setrlimit(resource.RLIMIT_CPU, (30,30))
resource.setrlimit(resource.RLIMIT_FSIZE, (262144,262144))
ROOT=Path(sys.argv[1]); SOURCE=Path('/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02/identity-rebind-01/rebind_identity.py')
start=time.monotonic()
spec=importlib.util.spec_from_file_location('synthetic_subject', SOURCE)
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
results=[]
def test(name, fn):
    try: fn(); results.append({'name':name,'status':'passed'})
    except Exception as e: results.append({'name':name,'status':'failed','error':type(e).__name__+': '+str(e)})
def eq(a,b):
    assert a==b, (a,b)
def rejects(fn,reason=None):
    try: fn()
    except (RuntimeError,OSError,UnicodeDecodeError) as e:
        if reason is not None: eq(str(e),reason)
        return
    raise AssertionError('invalid input accepted')
CPU=0x100000c; SUB=0; BASE=256; SIZE=768
uuid=bytes(range(16))
def section(name,addr,off,length,flags=0):
    return struct.pack('<16s16sQQIIIIIIII',name,b'__TEXT',addr,length,off,2,0,0,flags,0,0,0)
def fixture(fat64=False):
    commands=struct.pack('<II16s',0x1b,24,uuid)
    commands+=struct.pack('<II16sQQQQIIII',0x19,232,b'__TEXT',0x100000000,SIZE,0,SIZE,7,5,2,0)
    commands+=section(b'__text',0x100000180,384,16)+section(b'__const',0x1000001a0,416,12)
    commands+=struct.pack('<IIII',0x26,16,448,4)+struct.pack('<IIII',0x1d,16,464,16)
    sl=bytearray(SIZE); sl[:32]=struct.pack('<IIIIIIII',0xfeedfacf,CPU,SUB,2,4,len(commands),0,0)
    sl[32:32+len(commands)]=commands
    sl[384:400]=bytes(range(16,32)); sl[416:428]=b'CONSTabcdefg'; sl[448:452]=b'\x01\x03\x00\x00'; sl[464:480]=b'signaturefixture'
    head=struct.pack('>II',0xcafebabf if fat64 else 0xcafebabe,1)
    head+=struct.pack('>IIQQII',CPU,SUB,BASE,SIZE,8,0) if fat64 else struct.pack('>IIIII',CPU,SUB,BASE,SIZE,8)
    return bytearray(head+bytes(BASE-len(head))+sl)
p=ROOT/'fixture.bin'
def with_file(data,fn,total=None):
    p.write_bytes(data)
    fd=os.open(p,os.O_RDONLY)
    try: return fn(fd,len(data) if total is None else total)
    finally: os.close(fd)
def parse(data): return with_file(data,m.macho)
def put(data,off,fmt,*v):
    b=bytearray(data);struct.pack_into(fmt,b,off,*v);return b
base=fixture()
def valid(fat64):
    data=fixture(fat64); r=parse(data); s=r['slices'][0]
    eq(r['fatMagic'],hex(0xcafebabf if fat64 else 0xcafebabe));eq(r['nfat'],1)
    for k,v in {'cpuType':hex(CPU),'cpuSubtype':'0x0','offset':BASE,'bytes':SIZE,'alignment':8,'filetype':2,'UUID':uuid.hex(),'ncmds':4,'sizeofcmds':288,'sha256':hashlib.sha256(data[BASE:]).hexdigest()}.items():eq(s[k],v)
    eq(len(s['sections']),2);eq(len(s['linkedit']),2)
    for x,name,off,n in zip(s['sections'],['__text','__const'],[384,416],[16,12]):
        eq(x['segment'],'__TEXT');eq(x['section'],name);eq(x['sliceOffset'],off);eq(x['bytes'],n);eq(x['zerofill'],False);eq(x['sha256'],hashlib.sha256(data[BASE+off:BASE+off+n]).hexdigest())
    for x,name,off,n in zip(s['linkedit'],['LC_FUNCTION_STARTS','LC_CODE_SIGNATURE'],[448,464],[4,16]):
        eq(x['kind'],name);eq(x['sliceOffset'],off);eq(x['bytes'],n);eq(x['sha256'],hashlib.sha256(data[BASE+off:BASE+off+n]).hexdigest())
for f in [False,True]:test('valid-fat'+('64' if f else '32')+'-all-fields-hashes',lambda f=f:valid(f))
cases=[
('bad-magic',put(base,0,'>I',0),'fat-header'),('no-slices',put(base,4,'>I',0),'fat-header'),('too-many-slices',put(base,4,'>I',9),'fat-header'),
('zero-slice',put(base,20,'>I',0),'slice-range'),('slice-overrun',put(base,20,'>I',SIZE+1),'slice-range'),('slice-in-table',put(base,16,'>I',16),'slice-range'),
('align-too-large',put(base,24,'>I',31),'slice-alignment'),('misaligned',put(base,24,'>I',9),'slice-alignment'),
('bad-slice-magic',put(base,BASE,'<I',0),'slice-header'),('cpu-mismatch',put(base,BASE+4,'<I',7),'slice-header'),('subtype-mismatch',put(base,BASE+8,'<I',1),'slice-header'),
('zero-commands',put(base,BASE+16,'<I',0),'commands-cap'),('too-many-commands',put(base,BASE+16,'<I',4097),'commands-cap'),('commands-too-short',put(base,BASE+20,'<I',24),'commands-cap'),('commands-outside-slice',put(base,BASE+20,'<I',SIZE),'commands-cap'),
('command-size-zero',put(base,BASE+36,'<I',0),'command-size'),('command-size-small',put(base,BASE+36,'<I',4),'command-size'),('command-unaligned',put(base,BASE+36,'<I',23),'command-size'),('command-overrun',put(base,BASE+36,'<I',296),'command-size'),('uuid-wrong-size',put(base,BASE+36,'<I',16),'uuid'),
('segment-short',put(base,BASE+60,'<I',64),'segment-command'),('segment-overrun',put(base,BASE+104,'<Q',SIZE+1),'segment-file-range'),('section-count-mismatch',put(base,BASE+120,'<I',1),'section-count'),
('section-overrun',put(base,BASE+168,'<Q',SIZE),'section-file-range'),('section-offset-overrun',put(base,BASE+176,'<I',SIZE+1),'section-file-range'),
('linkedit-wrong-size',put(base,BASE+292,'<I',8),'linkedit-command'),('linkedit-offset-overrun',put(base,BASE+296,'<I',SIZE+1),'linkedit-range'),('linkedit-size-overrun',put(base,BASE+300,'<I',SIZE),'linkedit-range'),
('missing-uuid',put(base,BASE+32,'<I',0),'commands-exact'),('commands-trailing',put(base,BASE+16,'<I',3),'commands-exact'),
('fat64-reserved',put(fixture(True),36,'>I',1),'fat-reserved')]
for name,data,reason in cases:test(name,lambda data=data,reason=reason:rejects(lambda:parse(data),reason))
for n in [0,7,8,27,BASE-1,len(base)-1]:test('truncation-'+str(n),lambda n=n:rejects(lambda:parse(base[:n])))
b=put(base,4,'>I',2);b[28:48]=struct.pack('>IIIII',CPU,SUB,BASE,SIZE,8)
test('overlapping-fat-slices',lambda:rejects(lambda:parse(b),'overlap-slices'))
b2=bytearray(base);b2[BASE+288:BASE+312]=struct.pack('<II16s',0x1b,24,uuid);b2=put(b2,BASE+20,'<I',296)
test('duplicate-uuid',lambda:rejects(lambda:parse(b2),'uuid'))
for fn,label in [(m.read_at,'read'),(m.hash_at,'hash')]:
    for off,n in [(-1,1),(0,-1),(len(base)+1,0),(len(base),1),(1,len(base))]:
        test(label+'-range-'+str((off,n)),lambda fn=fn,off=off,n=n,label=label:with_file(base,lambda fd,t:rejects(lambda:fn(fd,off,n,t),label+'-range')))
test('read-exact',lambda:with_file(base,lambda fd,t:eq(m.read_at(fd,BASE+384,16,t),bytes(range(16,32)))))
test('read-empty-at-end',lambda:with_file(base,lambda fd,t:eq(m.read_at(fd,t,0,t),b'')))
test('hash-empty-at-end',lambda:with_file(base,lambda fd,t:eq(m.hash_at(fd,t,0,t),hashlib.sha256(b'').hexdigest())))
test('hash-whole',lambda:with_file(base,lambda fd,t:eq(m.hash_at(fd,0,t,t),hashlib.sha256(base).hexdigest())))
for fn,label in [(m.read_at,'read'),(m.hash_at,'hash')]:test(label+'-actual-short-file',lambda fn=fn:with_file(base,lambda fd,t:rejects(lambda:fn(fd,0,t+1,t+1),'short-read')))
def opened_valid():
    p.write_bytes(base);fd,s=m.open_regular(p,len(base))
    try:eq(s.st_size,len(base));eq(os.read(fd,8),bytes(base[:8]))
    finally:os.close(fd)
test('open-regular-valid-cap-equal',opened_valid)
def fdset():
    out=set()
    for fd in range(256):
        try:os.fstat(fd);out.add(fd)
        except OSError:pass
    return out
def open_rejection(name,path,data,cap,leak_check=False):
    if data is not None:p.write_bytes(data)
    before=fdset()
    try:
        rejects(lambda:m.open_regular(path,cap))
        if leak_check:eq(fdset()-before,set())
    finally:
        for fd in fdset()-before:os.close(fd)
for name,data,cap in [('empty',b'',1024),('over-cap',base,100)]:
    test('open-reject-'+name,lambda name=name,data=data,cap=cap:open_rejection(name,p,data,cap))
    test('open-reject-'+name+'-no-fd-leak',lambda name=name,data=data,cap=cap:open_rejection(name,p,data,cap,True))
test('open-reject-directory',lambda:open_rejection('directory',ROOT,None,1024))
test('open-reject-directory-no-fd-leak',lambda:open_rejection('directory',ROOT,None,1024,True))
p.write_bytes(base); link=ROOT/'link';link.symlink_to(p)
test('open-reject-symlink',lambda:open_rejection('symlink',link,None,2048,True))
def stat_race_no_leak():
    from types import SimpleNamespace
    p.write_bytes(base)
    before=fdset()
    real_stat=m.os.stat
    calls=[]
    def fake_stat(path,*args,**kwargs):
        result=real_stat(path,*args,**kwargs)
        if os.fspath(path)==os.fspath(p):
            calls.append((str(path),kwargs))
            return SimpleNamespace(st_dev=result.st_dev,st_ino=result.st_ino,st_size=result.st_size,st_mtime_ns=result.st_mtime_ns+1,st_ctime_ns=result.st_ctime_ns)
        return result
    try:
        m.os.stat=fake_stat
        try:
            rejects(lambda:m.open_regular(p,len(base)),'input-path-race')
        finally:
            m.os.stat=real_stat
        eq(len(calls),1)
        eq(calls[0][1],{'follow_symlinks':False})
        eq(fdset()-before,set())
    finally:
        m.os.stat=real_stat
        for fd in fdset()-before:os.close(fd)
test('open-reject-controlled-stat-path-race-no-fd-leak',stat_race_no_leak)
report={'source':str(SOURCE),'sourceSha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),'python':sys.version,'passed':sum(r['status']=='passed' for r in results),'failed':sum(r['status']=='failed' for r in results),'cases':results,'wallSeconds':time.monotonic()-start,'cpuSeconds':time.process_time(),'scope':'synthetic static tests only; main never called; no official targets/HOME/settings/network/credentials accessed','notVerified':['real official inputs','Mac M3 or loaded-image identity','main snapshot pipeline','concurrent replacement races','cryptographic code signature validity','full Mach-O semantic validity','multi-chunk hashing (CHUNK=1MiB; generation cap 256KiB)']}
(ROOT/'results.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='cases'},indent=2))
for r in results:
    if r['status']=='failed':print(json.dumps(r))
sys.exit(1 if report['failed'] else 0)
