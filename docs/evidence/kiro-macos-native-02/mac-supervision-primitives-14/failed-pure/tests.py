import ast,struct,pathlib,hashlib,json,sys,resource,signal,time,traceback,random
resource.setrlimit(resource.RLIMIT_CPU,(20,20))
resource.setrlimit(resource.RLIMIT_FSIZE,(4*1024*1024,4*1024*1024))
signal.alarm(60)
P=pathlib.Path(__file__).resolve().parent
start=time.monotonic()
source=(P/'frozen-locate_fixups.py').read_bytes()
tree=ast.parse(source)
names={'unpack_at','metadata','decode_pointer','walk_chains'}
selected=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in names]
assert len(selected)==4
ns={'struct':struct}
exec(compile(ast.Module(body=selected,type_ignores=[]),'frozen-four-functions','exec'),ns)
u,m,d,w=(ns[x] for x in ('unpack_at','metadata','decode_pointer','walk_chains'))
results=[]
def case(name,fn,scope='supported'):
    try:
        detail=fn()
        result={'name':name,'scope':scope,'status':'PASS','detail':detail}
    except Exception as e:
        result={'name':name,'scope':scope,'status':'FAIL','error':repr(e),'traceback':traceback.format_exc()}
    results.append(result)
    print(json.dumps(result,sort_keys=True),flush=True)
def eq(a,b):
    if a!=b: raise AssertionError('actual='+repr(a)+' expected='+repr(b))
    return {'actual':a,'expected':b}
def reject(fn):
    try: value=fn()
    except (ValueError,struct.error,UnicodeDecodeError) as e: return {'rejected':type(e).__name__,'message':str(e)}
    raise AssertionError('accepted invalid input; actual='+repr(value)[:1800])
def word(target=0,high=0,nxt=0,bind=False,auth=False,ordinal=0,div=0,addr=0,key=0,addend=0):
    x=(nxt<<51)|(int(bind)<<62)|(int(auth)<<63)
    if bind:x|=ordinal
    else:x|=target
    if auth:x|=(div<<32)|(addr<<48)|(key<<49)
    elif bind:x|=(addend & ((1<<19)-1))<<32
    else:x|=high<<43
    return x
# Independently construct complete thin arm64e images. Segments file backed, separate payload.
def image(roots=None,formats=None,pagesize=4096,base=0x100000000,imports=2,lengths=None):
    if roots is None:roots=[[0xffff],[0]]
    n=len(roots);formats=formats or [1]*n
    segbytes=[max(1,len(r))*pagesize for r in roots]
    if lengths is not None:segbytes=lengths
    fileoffs=[];vmoffs=[];f=0;v=0
    for size in segbytes:
        fileoffs.append(f);vmoffs.append(v);f+=size;v+=((size+4095)//4096)*4096
    payload=bytearray(28+4+4*n)
    struct.pack_into('<I',payload,28,n)
    info=[]
    for i,r in enumerate(roots):
        at=len(payload);info.append(at)
        struct.pack_into('<I',payload,32+4*i,at-28)
        payload.extend(struct.pack('<IHHQIH',22+len(r)*2,pagesize,formats[i],vmoffs[i],0,len(r)))
        payload.extend(struct.pack('<'+'H'*len(r),*r))
    imp=len(payload);payload.extend(b'\0'*(imports*4));sym=len(payload);payload.extend(b'x\0')
    struct.pack_into('<7I',payload,0,0,28,imp,sym,imports,1,0)
    commands=bytearray()
    segcmd=[]
    for i in range(n):
        segcmd.append(32+len(commands))
        name=b'__TEXT' if i==0 else ('__DATA%d'%i).encode()
        commands.extend(struct.pack('<II16sQQQQiiII',0x19,72,name,base+vmoffs[i],segbytes[i],fileoffs[i],segbytes[i],7,3,0,0))
    fc=32+len(commands)
    commands.extend(struct.pack('<IIII',0x80000034,16,f,len(payload)))
    b=bytearray(f+len(payload))
    b[:32]=struct.pack('<IiiIIIII',0xfeedfacf,0x100000c,2,2,n+1,len(commands),0,0)
    b[32:32+len(commands)]=commands;b[f:]=payload
    return b,{'payload':f,'infos':[f+x for x in info],'segcmd':segcmd,'fixcmd':fc,'fileoffs':fileoffs,'vmoffs':vmoffs}
def mutate(b,fmt,at,*vals):
    c=bytearray(b);struct.pack_into(fmt,c,at,*vals);return c
def rows(b):return w(b,m(b))
base=0x100000000
# Scalar and field boundary tests.
case('unpack exact edge',lambda:eq(u(b'12345678','<I',4),(0x38373635,)))
for off in (-1,1,True,1.0):case('unpack invalid offset '+repr(off),lambda off=off:reject(lambda:u(b'1234','<I',off)))
case('unpack truncated',lambda:reject(lambda:u(b'123','<I',0)))
for value in (-1,1<<64,True,0.0):
    case('invalid word '+repr(value),lambda value=value:reject(lambda:d(value,1,base)))
    case('invalid base '+repr(value),lambda value=value:reject(lambda:d(0,1,value)))
for fmt in (0,2,6,7,10,13):case('unsupported decoder format '+str(fmt),lambda fmt=fmt:reject(lambda:d(0,fmt,base)))
for fmt in (1,9,12):
    for target in (0,1,0x123456789,(1<<43)-1):
        for high in (0,0x7f,0xff):
            expected=(target if fmt==1 else base+target)|(high<<56)
            case('unauth f%d low%x hi%x'%(fmt,target,high),lambda fmt=fmt,target=target,high=high,expected=expected:eq(d(word(target,high),fmt,base)['targetVA'],expected))
    for nxt in (0,1,511,1024,2047):
        case('next bits f%d n%d'%(fmt,nxt),lambda fmt=fmt,nxt=nxt:eq(d(word(nxt=nxt),fmt,base)['nextCount'],nxt))
    for target in (0,0xffffffff):
        for key in range(4):
            for addr in (0,1):
                x=word(target=target,nxt=2047,auth=True,div=0xa5c3,addr=addr,key=key)
                expected=(base+target,0xa5c3,bool(addr),key,2047,True,False)
                case('PAC f%d t%x k%d a%d'%(fmt,target,key,addr),lambda x=x,fmt=fmt,expected=expected:eq(tuple(d(x,fmt,base)[k] for k in ('targetVA','diversity','addrDiv','key','nextCount','auth','bind')),expected))
    width=24 if fmt==12 else 16
    for auth in (False,True):
        for ordinal in (0,65535,(1<<width)-1):
            x=word(bind=True,auth=auth,ordinal=ordinal,nxt=37,div=0xbeef,addr=1,key=3,addend=-1)
            case('bind f%d a%d ord%d'%(fmt,auth,ordinal),lambda x=x,fmt=fmt,ordinal=ordinal:eq((d(x,fmt,base)['ordinal'],d(x,fmt,base)['targetVA'],d(x,fmt,base)['nextCount']),(ordinal,None,37)))
        for bit in range(width,32):
            case('reserved f%d a%d bit%d'%(fmt,auth,bit),lambda fmt=fmt,auth=auth,bit=bit:reject(lambda:d(word(bind=True,auth=auth)|(1<<bit),fmt,base)))
    case('auth target overflow f%d'%fmt,lambda fmt=fmt:reject(lambda:d(word(target=1,auth=True),fmt,(1<<64)-1)))
for fmt in (9,12):
    case('unauth overflow f%d'%fmt,lambda fmt=fmt:reject(lambda:d(word(target=1),fmt,(1<<56)-1)))
    case('unauth largest representable f%d'%fmt,lambda fmt=fmt:eq(d(word(target=0,high=255),fmt,(1<<56)-1)['targetVA'],(1<<64)-1))
# Integration baseline and chain variants.
b,layout=image()
case('valid no roots',lambda:eq(rows(image(roots=[[65535],[65535]])[0]),[]))
case('empty page arrays valid',lambda:eq(rows(image(roots=[[],[]])[0]),[]))
case('default terminal zero node',lambda:eq([(r['sliceFileOffset'],r['targetVA']) for r in rows(b)],[(4096,0)]))
for fmt in (1,9,12):
    c,l=image(formats=[fmt,fmt]);o=l['fileoffs'][1]
    for offset,x in [(0,word(target=0x222,nxt=2)),(16,word(bind=True,ordinal=1,nxt=1)),(24,word(target=0x555,auth=True,div=0x3456,key=2))]:struct.pack_into('<Q',c,o+offset,x)
    expected=[0x222 if fmt==1 else base+0x222,None,base+0x555]
    case('mixed linked integration f%d'%fmt,lambda c=c,expected=expected:eq([r['targetVA'] for r in rows(c)],expected))
    for auth in (False,True):
        for ordinal,ok in ((0,True),(1,True),(2,False),(65535,False)):
            c,l=image(formats=[fmt,fmt]);struct.pack_into('<Q',c,4096,word(bind=True,auth=auth,ordinal=ordinal))
            case('ordinal bounds f%d a%d o%d'%(fmt,auth,ordinal),lambda c=c,ok=ok:eq(len(rows(c)),1) if ok else reject(lambda:rows(c)))
for root in (0,8,4088):
    c,l=image(roots=[[65535],[root]])
    case('valid root edge '+str(root),lambda c=c,root=root:eq(rows(c)[0]['sliceFileOffset'],4096+root))
for root in (1,7,4092,4096,0x8000,0xfffe):
    c,l=image(roots=[[65535],[root]])
    case('invalid root '+str(root),lambda c=c:reject(lambda:rows(c)))
c,l=image(roots=[[65535],[0,65535,4088],[8]],formats=[1,9,12]);
case('multiple segments and pages',lambda:eq([(r['segmentIndex'],r['sliceFileOffset']) for r in rows(c)],[(1,4096),(1,4096+8192+4088),(2,16384+8)]))
c,l=image(roots=[[65535],[16376]],pagesize=16384)
case('16KiB page edge',lambda:eq(rows(c)[0]['sliceFileOffset'],32760))
c,l=image();struct.pack_into('<Q',c,4096,word(nxt=512))
case('next escapes page',lambda:reject(lambda:rows(c)))
c,l=image(roots=[[65535],[4088]]);struct.pack_into('<Q',c,8184,word(nxt=1))
case('next at page edge escape',lambda:reject(lambda:rows(c)))
c,l=image(lengths=[4096,4092],roots=[[65535],[4088]])
case('partial file segment escape',lambda:reject(lambda:rows(c)))
# Full image malformed headers and payloads.
b,l=image();p=l['payload'];info=l['infos'][1];sc=l['segcmd'][1];fc=l['fixcmd']
mutations=[
 ('wrong magic','<I',0,0),('wrong cpu','<I',4,0),('wrong subtype','<I',8,1),
 ('zero commands','<I',16,0),('command count cap','<I',16,129),('command bytes OOB','<I',20,len(b)),
 ('command short','<I',36,4),('command alignment','<I',36,73),('command overrun','<I',36,len(b)),
 ('segment short','<I',36,64),('fixup command size','<I',fc+4,24),
 ('segment file OOB','<Q',sc+48,len(b)),('segment filesize exceeds vmsize','<Q',sc+32,8),
 ('segment VA overflow','<Q',sc+24,(1<<64)-4096),('wrong TEXT name','<16s',40,b'NOTTEXT'),
 ('fixups too short','<I',fc+12,27),('payload cap','<I',fc+12,131073),('payload offset OOB','<I',fc+8,len(b)),
 ('version unsupported','<I',p,1),('starts before header','<I',p+4,27),('starts past payload','<I',p+4,len(b)-p),
 ('imports before header','<I',p+8,27),('imports OOB','<I',p+8,len(b)-p),
 ('symbols before header','<I',p+12,27),('symbols OOB','<I',p+12,len(b)-p+1),
 ('imports count cap','<I',p+16,65537),('imports format','<I',p+20,4),('symbols format','<I',p+24,2),
 ('segment count mismatch','<I',p+28,1),('segment record overlaps index','<I',p+36,4),
 ('segment record OOB','<I',p+36,len(b)),('record length too short','<I',info,23),('record length OOB','<I',info,131000),
 ('invalid page size','<H',info+4,8192),('page count cap','<H',info+20,513),
 ('root mapping mismatch','<Q',info+8,8192),('too many segment pages','<H',info+20,2),
 ('record overlap','<I',p+36,l['infos'][0]-p-28)]
for name,fmt,at,val in mutations:
    c=mutate(b,fmt,at,val)
    case(name,lambda c=c:reject(lambda:rows(c)))
for cut in (0,1,31,32,39,100,p-1,len(b)-1):case('truncation '+str(cut),lambda cut=cut:reject(lambda:rows(b[:cut])))
c,l=image(formats=[1,2])
case('unsupported chain format',lambda:reject(lambda:rows(c)))
c,l=image(formats=[1,2],roots=[[65535],[65535]])
case('unsupported even without roots stops',lambda:reject(lambda:rows(c)))
# Duplicate defense and global count cap, independent direct metadata to isolate guards.
segment={'name':'__DATA','va':base,'vsize':4096,'offset':0,'bytes':4096}
record={'segmentIndex':0,'pointerFormat':1,'pageSize':4096,'pageStarts':[0]}
meta={'base':base,'importsCount':0,'segments':[segment],'records':[record,dict(record)]}
case('duplicate file node',lambda:reject(lambda:w(bytes(4096),meta)))
capdata=bytearray(33*4096)
for i in range(16385):
    if i%512!=511 and i!=16384:struct.pack_into('<Q',capdata,i*8,word(nxt=1))
capmeta={'base':base,'importsCount':0,'segments':[{'name':'__DATA','va':base,'vsize':len(capdata),'offset':0,'bytes':len(capdata)}],'records':[{'segmentIndex':0,'pointerFormat':1,'pageSize':4096,'pageStarts':[0]*33}]}
case('16385th node rejected',lambda:reject(lambda:w(capdata,capmeta)))
exactmeta={'base':base,'importsCount':0,'segments':capmeta['segments'],'records':[dict(capmeta['records'][0],pageStarts=[0]*32)]}
case('16384 nodes accepted',lambda:eq(len(w(capdata,exactmeta)),16384))
# Whole-format checks, separate from supported locator contract. These deliberately expose missing validation.
b,l=image();p=l['payload'];info=l['infos'][1]
for name,c in [
 ('imports overlap segment roots',mutate(b,'<I',p+8,info-p)),
 ('imports overlap starts index',mutate(b,'<I',p+8,28)),
 ('symbols overlap fixups header',mutate(b,'<I',p+12,28)),
 ('starts unaligned',mutate(b,'<I',p+4,29))]:
    case(name,lambda c=c:reject(lambda:rows(c)),scope='whole-format-hardening')
# Payload claims a 24-byte command with section count 1 but no section storage: general Mach-O validation absent.
c=mutate(b,'<I',l['segcmd'][1]+64,1)
case('segment nsects exceeds command storage',lambda:reject(lambda:rows(c)),scope='whole-format-hardening')
# Deterministic independent bit oracle across 240 mixed pointer values.
rng=random.Random(140029)
def oracle_random():
    count=0
    for fmt in (1,9,12):
        for i in range(80):
            auth=bool(rng.getrandbits(1));bind=bool(rng.getrandbits(1));nxt=rng.randrange(2048)
            target=rng.randrange(1<<(32 if auth else 43));high=rng.randrange(256);ordinal=rng.randrange(1<<(24 if fmt==12 else 16));div=rng.randrange(65536);addr=rng.randrange(2);key=rng.randrange(4)
            x=word(target,high,nxt,bind,auth,ordinal,div,addr,key,rng.randrange(-262144,262144));r=d(x,fmt,base)
            eq(r['rawHex'],format(x,'016x'));eq(r['nextCount'],nxt);eq((r['auth'],r['bind']),(auth,bind))
            if auth:eq((r['diversity'],r['addrDiv'],r['key']),(div,bool(addr),key))
            if bind:eq((r['ordinal'],r['targetVA']),(ordinal,None))
            else:eq(r['targetVA'],base+target if auth else ((target if fmt==1 else base+target)|(high<<56)))
            count+=1
    return {'vectors':count}
case('seeded independent field oracle',oracle_random)
summary={'sourceSHA256':hashlib.sha256(source).hexdigest(),'cases':len(results),'passed':sum(r['status']=='PASS' for r in results),'failed':sum(r['status']=='FAIL' for r in results),'elapsedSeconds':time.monotonic()-start,'results':results,'extraction':sorted(names),'globals':['struct','builtins'],'randomSeed':140029}
(P/'results.json').write_text(json.dumps(summary,indent=2)+'\n')
print('SUMMARY '+json.dumps({k:v for k,v in summary.items() if k!='results'}),flush=True)
sys.exit(1 if summary['failed'] else 0)
