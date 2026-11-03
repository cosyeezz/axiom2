import ast, hashlib, json, pathlib, resource, signal, struct, sys, time, uuid
D=pathlib.Path(__file__).resolve().parent
resource.setrlimit(resource.RLIMIT_CPU,(12,12)); signal.alarm(25)
t0=time.monotonic(); cpu0=time.process_time()
source=(D/'source.py').read_bytes(); sha=hashlib.sha256(source).hexdigest()
tree=ast.parse(source)
allowed={'signed','parse','find_xrefs','direct_branches','make_carrier'}
nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in allowed]
nodes += [n for n in tree.body if isinstance(n,ast.Assign) and all(isinstance(t,ast.Name) and t.id in {'LITERAL','IMPORT'} for t in n.targets)]
ns={'struct':struct,'hashlib':hashlib,'uuid':uuid}
exec(compile(ast.Module(body=nodes,type_ignores=[]),'frozen-pure-helpers','exec'),ns)
signed,parse,xrefs,branches,carrier=[ns[k] for k in ('signed','parse','find_xrefs','direct_branches','make_carrier')]
results=[]
def check(name,fn,category='contract'):
    try:
        fn(); results.append({'name':name,'status':'PASS','category':category})
    except Exception as e:
        results.append({'name':name,'status':'FAIL','category':category,'error':type(e).__name__+': '+str(e)})
def eq(got,want):
    if got!=want: raise AssertionError('got '+repr(got)+' expected '+repr(want))
def reject(raw):
    try: parse(raw)
    except (ValueError,struct.error,KeyError,UnicodeError): return
    raise AssertionError('malformed fixture accepted')
def words(*xs):return struct.pack('<'+'I'*len(xs),*xs)
def adr(delta,rd=3,page=False):
    v=delta&((1<<21)-1)
    return (0x90000000 if page else 0x10000000)|((v&3)<<29)|((v>>2)<<5)|rd
def add(imm,rn=3,rd=4,shift=0):return 0x91000000|(shift<<22)|(imm<<10)|(rn<<5)|rd
for bits in (21,26):
    for value in (0,1,(1<<(bits-1))-1,1<<(bits-1),(1<<bits)-2,(1<<bits)-1):
        expected=value if value<(1<<(bits-1)) else value-(1<<bits)
        check('signed%d_%x'%(bits,value),lambda v=value,b=bits,e=expected:eq(signed(v,b),e))
base=0x100008ffc
for delta in (-(1<<20),-4097,-1,0,1,4096,(1<<20)-1):
    check('ADR_%d'%delta,lambda d=delta:eq(xrefs(words(adr(d)),base,base+d),[{'va':base,'kind':'ADR'}]))
    check('ADR_wrong_target_%d'%delta,lambda d=delta:eq(xrefs(words(adr(d)),base,base+d+1),[]))
for pages in (-(1<<20),-3,-1,0,1,3,(1<<20)-1):
    for shift in (0,1):
        imm=0x321; target=(base&~4095)+(pages<<12)+(imm<<(12 if shift else 0))
        check('ADRP_ADD_%d_shift%d'%(pages,shift),lambda p=pages,s=shift,t=target:eq(xrefs(words(adr(p,page=True),add(imm,shift=s)),base,t),[{'va':base,'addVA':base+4,'kind':'adjacent ADRP+ADD'}]))
check('ADRP_wrong_source_register',lambda:eq(xrefs(words(adr(1,page=True),add(7,rn=2)),base,(base&~4095)+4096+7),[]))
check('ADRP_wrong_page',lambda:eq(xrefs(words(adr(1,page=True),add(7)),base,base+4096+7),[]))
check('ADRP_wrong_sign',lambda:eq(xrefs(words(adr(-1,page=True),add(7)),base,(base&~4095)+4096+7),[]))
check('ADD_shift_not_ignored',lambda:eq(xrefs(words(adr(0,page=True),add(7,shift=1)),base,(base&~4095)+7),[]))
for name,following in [('32bit_ADD',add(7)&~(1<<31)),('SUB',add(7)|(1<<30)),('ADDS',add(7)|(1<<29))]:
    check(name,lambda w=following:eq(xrefs(words(adr(1,page=True),w),base,(base&~4095)+4096+7),[]))
check('deliberately_missed_nonadjacent',lambda:eq(xrefs(words(adr(1,page=True),0xd503201f,add(7)),base,(base&~4095)+4096+7),[]),'documented limitation')
check('ADRP_without_following',lambda:eq(xrefs(words(adr(1,page=True)),base,(base&~4095)+4096),[]))
check('ADD_destination_may_differ',lambda:eq(xrefs(words(adr(1,rd=8,page=True),add(7,rn=8,rd=19)),base,(base&~4095)+4096+7),[{'va':base,'addVA':base+4,'kind':'adjacent ADRP+ADD'}]))
check('ADRP_XZR_then_ADD_SP_false_positive',lambda:eq(xrefs(words(adr(1,rd=31,page=True),add(7,rn=31)),base,(base&~4095)+4096+7),[]),'instruction validity')
check('ADD_reserved_bit23_false_positive',lambda:eq(xrefs(words(adr(1,page=True),add(7)|(1<<23)),base,(base&~4095)+4096+7),[]),'instruction validity')
for op,name in ((0x94000000,'BL'),(0x14000000,'B')):
    for delta in (-(1<<25),-1,0,1,(1<<25)-1):
        for selected in (False,True):
            target=base+(delta<<2)
            row={'va':base,'kind':name,'target':target,'selectedImportStub':selected}
            check('%s_%d_selected%s'%(name,delta,selected),lambda o=op,d=delta,t=target,r=row,s=selected:eq(branches(words(o|(d&0x3ffffff)),base,{t} if s else {t+4}),[r]))
check('branch_pc_uses_instruction_offset',lambda:eq(branches(words(0xd503201f,0x94000001),base,{base+8}),[{'va':base+4,'kind':'BL','target':base+8,'selectedImportStub':True}]))
check('conditional_register_branches_not_direct',lambda:eq(branches(words(0x54000000,0xd61f0060,0xd63f0060,0xd65f03c0),base,set()),[]))
for address in (0,0x100008ffc,0xfffffff000000000):
    for code in (b'',words(0xd503201f,0xd65f03c0),b'\x00\xff\x7f'):
        def test_carrier(a=address,c=code):
            out=carrier(c,a);h=struct.unpack_from('<IiiIIIII',out);sg=struct.unpack_from('<II16sQQQQiiII',out,32);sc=struct.unpack_from('<16s16sQQIIIIIIII',out,104)
            eq(h,(0xfeedfacf,0x100000c,-2147483646,1,1,152,0,0));eq(sg,(0x19,152,b'__TEXT'+b'\0'*10,a,len(c),184,len(c),7,5,1,0))
            eq(sc,(b'__text'+b'\0'*10,b'__TEXT'+b'\0'*10,a,len(c),184,2,0,0,0x80000400,0,0,0));eq(out[184:],c);eq(len(out),184+len(c))
        check('carrier_%x_len%d'%(address,len(code)),test_carrier)
BASE=0x100000000
U=uuid.UUID('12345678-1234-5678-1234-567812345678')
def section(name,off,size,flags=0,start=0,width=0):
    return struct.pack('<16s16sQQIIIIIIII',name,b'__TEXT',BASE+off,size,off,2,0,0,flags,start,width,0)
def fixture(starts=b'\x80\x05\x10\0',literal=None):
    literal=ns['LITERAL'] if literal is None else literal
    seg=struct.pack('<II16sQQQQiiII',0x19,312,b'__TEXT',BASE,1024,0,1024,7,5,3,0)
    seg+=section(b'__text',640,32)+section(b'__cstring',672,len(literal))+section(b'__stubs',848,12,8,0,12)
    cmds=[seg,struct.pack('<II',0x1b,24)+U.bytes,struct.pack('<IIII',0x26,16,720,len(starts)),struct.pack('<IIIIII',2,24,736,1,768,64)]
    dys=[0]*20;dys[0:2]=[0xb,80];dys[14:16]=[832,1];cmds.append(struct.pack('<20I',*dys))
    cb=b''.join(cmds);raw=bytearray(1024);raw[:32]=struct.pack('<IiiIIIII',0xfeedfacf,0x100000c,-2147483646,2,5,len(cb),0,0);raw[32:32+len(cb)]=cb
    raw[640:672]=words(*([0xd503201f]*8));raw[672:672+len(literal)]=literal;raw[720:720+len(starts)]=starts
    struct.pack_into('<IBBHQ',raw,736,1,1,0,0,0);ss=b'\0'+ns['IMPORT']+b'\0';raw[768:768+len(ss)]=ss;struct.pack_into('<I',raw,832,0)
    return bytes(raw)
def patch(raw,offset,fmt,*values):
    b=bytearray(raw);struct.pack_into(fmt,b,offset,*values);return bytes(b)
raw=fixture()
def valid(data,off=0):
    m=parse(data);eq(m['sliceOffset'],off);eq(m['sliceBytes'],1024);eq(m['sliceSHA256'],hashlib.sha256(raw).hexdigest());eq(m['uuid'],str(U).upper());eq(m['data'],raw)
    eq(m['literalVA'],BASE+672);eq(m['literalFileOffset'],off+672);eq(m['starts'],[BASE+640,BASE+656]);eq(m['text']['offset'],640)
    eq(m['selectedImportStubs'],[{'va':BASE+848,'fileOffset':off+848,'bytes':12,'section':'__stubs'}])
check('parse_thin_arm64e_all_metadata',lambda:valid(raw))
for wide in (False,True):
    off=4096; magic=b'\xca\xfe\xba\xbf' if wide else b'\xca\xfe\xba\xbe'
    entry=struct.pack('>IIQQII',0x100000c,0x80000002,off,len(raw),12,0) if wide else struct.pack('>IIIII',0x100000c,2,off,len(raw),12)
    head=magic+struct.pack('>I',1)+entry; fat=head+b'\0'*(off-len(head))+raw
    check('parse_fat%d'%(64 if wide else 32),lambda b=fat:valid(b,4096))
    check('fat_range_%s'%wide,lambda b=fat:reject(b[:-1]))
    wrong=bytearray(fat);struct.pack_into('>I',wrong,12,0);check('fat_wrong_arch_%s'%wide,lambda b=bytes(wrong):reject(b))
    dup=magic+struct.pack('>I',2)+entry+entry;dup=dup+b'\0'*(off-len(dup))+raw
    check('fat_nonunique_%s'%wide,lambda b=dup:reject(b))
for name,b in [
 ('file_cap',b'\0'*(2*1024*1024+1)),('truncated_header',b'\xcf\xfa'),('wrong_magic',patch(raw,0,'<I',0)),('wrong_cpu',patch(raw,4,'<I',7)),('wrong_subtype',patch(raw,8,'<I',0)),
 ('fat_zero_count',b'\xca\xfe\xba\xbe'+struct.pack('>I',0)),('fat_count9',b'\xca\xfe\xba\xbe'+struct.pack('>I',9)),
 ('load_count_cap',patch(raw,16,'<I',129)),('load_bytes_cap',patch(raw,20,'<I',2000)),('load_size_small',patch(raw,36,'<I',4)),('load_range',patch(raw,36,'<I',1000)),('load_total',patch(raw,20,'<I',464)),
 ('section_count_cap',patch(raw,96,'<I',129)),('section_does_not_fit',patch(raw,96,'<I',4)),('text_size_cap',patch(raw,144,'<Q',512*1024+4)),('text_unaligned',patch(raw,144,'<Q',31)),('text_region',patch(raw,152,'<I',1020)),
 ('literal_missing',fixture(literal=b'other\0')),('literal_duplicate',fixture(literal=ns['LITERAL']*2)),('cstring_region',patch(raw,232,'<I',1024)),
 ('starts_no_terminator',fixture(starts=b'\x80\x05')),('starts_truncated_uleb',fixture(starts=b'\x80')),('starts_uleb_overflow',fixture(starts=b'\x80'*10)),('starts_region',patch(raw,376,'<I',1024)),('starts_byte_cap',patch(raw,380,'<I',65537)),
 ('symbols_region',patch(raw,392,'<I',1024)),('strings_region',patch(raw,400,'<I',1024)),('import_missing',patch(raw,769,'<B',88)),('indirect_region',patch(raw,464,'<I',1024)),('indirect_index',patch(raw,832,'<I',9)),
 ('stub_zero_width',patch(raw,336,'<I',0)),('stub_nondivisible',patch(raw,336,'<I',5)),('stub_indirect_start',patch(raw,332,'<I',1)),('stub_region',patch(raw,312,'<I',1024))]:
    check('parse_reject_'+name,lambda x=b:reject(x))
# Confirm intended permissive cases; these are not parser validity promises beyond the experiment.
check('starts_terminator_trailing_padding_accepted',lambda:eq(parse(fixture(starts=b'\x80\x05\0\xff'))['starts'],[BASE+640]))
check('zero_delta_stops_starts',lambda:eq(parse(fixture(starts=b'\0'))['starts'],[]),'helper-only contract')
summary={'sourceSHA256':sha,'cases':len(results),'passed':sum(r['status']=='PASS' for r in results),'failed':sum(r['status']=='FAIL' for r in results),'wallSeconds':time.monotonic()-t0,'cpuSeconds':time.process_time()-cpu0,'results':results,'noMainExecuted':True,'onlySyntheticBinaryInputs':True}
(D/'results.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps({k:v for k,v in summary.items() if k!='results'}))
for r in results:
    if r['status']=='FAIL':print(json.dumps(r))
sys.exit(1 if summary['failed'] else 0)
