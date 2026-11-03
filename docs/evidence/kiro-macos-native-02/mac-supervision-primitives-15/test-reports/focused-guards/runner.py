import ast, difflib, hashlib, json, os, pathlib, resource, signal, struct, sys, time
D=pathlib.Path('/tmp/new15-independent-guards.87WKS3WO')
resource.setrlimit(resource.RLIMIT_CPU,(15,15))
resource.setrlimit(resource.RLIMIT_FSIZE,(4194304,4194304))
signal.alarm(60)
ROOT=pathlib.Path('/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02')
INPUTS={'new15':ROOT/'mac-supervision-primitives-15/locate_fixups.py','old14':ROOT/'mac-supervision-primitives-14/locate_fixups.py','experiment15':ROOT/'mac-supervision-primitives-15/EXPERIMENT.md','schema':ROOT/'mac-supervision-primitives-14/failed-pure/fixup-chains.h'}
def sha(b):return hashlib.sha256(b).hexdigest()
def save(name,b):
    if isinstance(b,str):b=b.encode()
    if len(b)>4194304:raise RuntimeError('file budget')
    total=sum(p.stat().st_size for p in D.rglob('*') if p.is_file())
    if total+len(b)>16777216:raise RuntimeError('total budget')
    p=D/name
    with p.open('xb') as f:f.write(b)
    p.chmod(0o400)
def read_source(p):
    a=p.stat(); b=p.read_bytes(); c=p.stat()
    fields=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
    if fields(a)!=fields(c):raise RuntimeError('source unstable')
    return b,{'path':str(p),'sha256':sha(b),'bytes':len(b),'stat':fields(c)}
raw={}; before={}
for k,p in INPUTS.items():
    raw[k],before[k]=read_source(p)
    save(k+'.before.txt',raw[k])
save('before.json',json.dumps(before,indent=2))
trees={k:ast.parse(raw[k],filename=str(INPUTS[k])) for k in ('new15','old14')}
names=('unpack_at','metadata','decode_pointer','walk_chains')
funcs={k:{n.name:n for n in t.body if isinstance(n,ast.FunctionDef)} for k,t in trees.items()}
ns={'struct':struct}
exec(compile(ast.Module(body=[funcs['new15'][k] for k in names],type_ignores=[]),str(INPUTS['new15'])+':AST-only','exec'),ns)
rows=[]
def result(name,expected,actual,detail=None):
    row={'name':name,'expected':expected,'actual':actual,'pass':actual==expected,'detail':detail}
    rows.append(row);print(json.dumps(row,sort_keys=True),flush=True)
for k in names:
    same=ast.dump(funcs['new15'][k],include_attributes=False)==ast.dump(funcs['old14'][k],include_attributes=False)
    result('AST_'+k, k!='metadata',same)
# Assert entire source differs only at the two declared guard regions.
old=raw['old14'].decode(); new=raw['new15'].decode()
insert="            nsects = unpack_at(data, '<I', cursor + 64)[0]\n            if nsects > 128 or 72 + 80 * nsects > size:\n                raise ValueError('section table storage')\n"
replace="    occupied = [(0, 28), (starts, starts + 4 + 4 * seg_count), (imports, imports + imports_count * import_width), (symbols, len(payload))]\n    occupied = sorted((a, b) for a, b in occupied if a < b)\n    if any(a[1] > b[0] for a, b in zip(occupied, occupied[1:])):\n        raise ValueError('overlapping payload regions outside supported contract')\n"
result('source_only_two_guard_regions',True,new.replace(insert,'').replace(replace,'    occupied = []\n')==old)
save('source.diff',''.join(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile='old14',tofile='new15')))
# All offsets below are synthetic. No original fixtures/harness imported or read.
def payload(starts=28,imports=60,symbols=64,count=1,iformat=1,sformat=0,size=68,records=None,rel=None,segs=1):
    b=bytearray(size)
    struct.pack_into('<7I',b,0,0,starts,imports,symbols,count,iformat,sformat)
    if records is None:records=[(36,24,1,65535,0)]
    if rel is None:rel=[records[0][0]-starts] if records else [0]*segs
    struct.pack_into('<I',b,starts,segs)
    struct.pack_into('<%dI'%segs,b,starts+4,*rel)
    for at,length,pages,root,seg_off in records:
        struct.pack_into('<IHHQIH',b,at,length,4096,9,seg_off,0,pages)
        if pages:struct.pack_into('<%dH'%pages,b,at+22,*([root]*pages))
    return bytes(b)
def image(p=None,nsects=0,cmdsize=None,segs=1,truncate=0):
    if p is None:p=payload()
    if cmdsize is None:cmdsize=72+80*nsects
    cb=cmdsize+72*(segs-1)+16
    off=((32+cb+63)//64)*64
    total=off+len(p)
    b=bytearray(total)
    struct.pack_into('<IiiIIIII',b,0,0xfeedfacf,0x100000c,2,2,segs+1,cb,0,0)
    cur=32
    for i in range(segs):
        sz=cmdsize if i==0 else 72
        struct.pack_into('<II16sQQQQiiII',b,cur,0x19,sz,b'__TEXT' if i==0 else b'__DATA',0x100000000,0x10000,0,total,7,5,nsects if i==0 else 0,0)
        cur+=sz
    struct.pack_into('<IIII',b,cur,0x80000034,16,off,len(p))
    b[off:]=p
    return bytes(b[:-truncate] if truncate else b)
def test(name,b,reason='accept',check=None):
    save('fixtures/'+name+'.bin',b)
    try:
        m=ns['metadata'](b)
        w=ns['walk_chains'](b,m)
        actual='accept'
        detail={'sha256':sha(b),'bytes':len(b),'records':m['records'],'walkRows':w}
        if check is not None and not check(m,w):actual='oracle mismatch'
    except Exception as e:
        actual=type(e).__name__+': '+str(e);detail={'sha256':sha(b),'bytes':len(b)}
    expected='accept' if reason=='accept' else 'ValueError: '+reason
    result(name,expected,actual,detail)
O='overlapping payload regions outside supported contract'
S='overlapping segment info'
# Abutting, empty, and region-order variants.
test('abutting_header_index_record_import_symbol',image())
for f,width in ((1,4),(2,8),(3,16)):
    for sf in (0,1):
        test('abutting_import_format%d_symbols%d'%(f,sf),image(payload(imports=60,symbols=60+width,size=64+width,iformat=f,sformat=sf)))
test('empty_imports_at_record_interior',image(payload(imports=44,count=0,symbols=60,size=64)))
test('empty_symbols_at_payload_end',image(payload(symbols=64,size=64)))
test('empty_imports_and_symbols_at_end',image(payload(imports=60,count=0,symbols=60,size=60)))
test('empty_imports_at_header_boundary',image(payload(imports=28,count=0,symbols=60,size=60)))
test('empty_page_roots',image(payload(records=[(36,22,0,0,0)],imports=58,symbols=62,size=64)),check=lambda m,w:m['records'][0]['pageStarts']==[] and w==[])
test('zero_segment_record_offsets',image(payload(records=[],imports=36,symbols=40,size=44)),check=lambda m,w:m['records']==[] and w==[])
# Starts need not precede imports. Order independently disjoint.
test('imports_before_starts',image(payload(starts=32,imports=28,symbols=64,size=68,records=[(40,24,1,65535,0)])))
test('no_imports_symbols_before_starts_rejected',image(payload(imports=68,count=0,symbols=28,size=68)),O)
# Pairwise table overlaps, including independent recreations of historical families.
test('failed14_family_starts_import_alias',image(payload(imports=32)),O)
test('failed14_family_starts_symbol_alias',image(payload(imports=68,count=0,symbols=32)),O)
test('failed14_family_import_symbol_alias',image(payload(symbols=62)),O)
test('imports_contain_starts',image(payload(imports=28,count=3)),O)
test('symbols_contain_starts',image(payload(imports=68,count=0,symbols=28)),O)
test('import_symbol_exact_alias',image(payload(symbols=60)),O)
# Record overlaps are checked against every nonempty occupied region.
test('record_import_partial_overlap',image(payload(imports=56,symbols=64)),S)
test('record_import_containment',image(payload(imports=40,symbols=64)),S)
test('record_symbol_partial_overlap',image(payload(imports=68,count=0,symbols=58)),S)
test('record_symbol_containment',image(payload(imports=68,count=0,symbols=36)),S)
b=bytearray(payload());struct.pack_into('<I',b,32,4)
test('record_overlaps_starts_index',image(bytes(b)),'segment info overlaps index')
p=payload(segs=2,records=[(40,24,1,65535,0)],rel=[12,12],imports=64,symbols=68,size=72)
test('record_record_alias',image(p,segs=2),S)
p=payload(segs=2,records=[(40,24,1,65535,0),(64,24,1,65535,0)],rel=[12,36],imports=88,symbols=92,size=96)
test('abutting_segment_records',image(p,segs=2))
# Header overlap attempts are rejected earlier by offsets, not by disjointness.
for field,offset in [('starts',4),('imports',8),('symbols',12)]:
    for val in (0,24,27):
        b=bytearray(payload());struct.pack_into('<I',b,offset,val)
        test(field+'_inside_header_'+str(val),image(bytes(b)),'fixups header offsets')
# Section storage exact boundaries. Contents intentionally opaque: storage, not section semantics.
for name,n,sz,reason in [
 ('nsects0_exact',0,72,'accept'),('nsects0_padded',0,152,'accept'),
 ('nsects1_exact',1,152,'accept'),('failed14_family_nsects_missing_storage',1,72,'section table storage'),
 ('nsects1_short8',1,144,'section table storage'),
 ('nsects128_exact_cap',128,10312,'accept'),('nsects128_short8',128,10304,'section table storage'),
 ('nsects129_full_storage',129,10392,'section table storage'),('nsects129_no_storage',129,72,'section table storage'),
 ('nsects_uint32max',0xffffffff,72,'section table storage')]:
    test(name,image(nsects=n,cmdsize=sz),reason)
# Truncation at different ownership boundaries, preserving the actual guard.
b=bytearray(image(nsects=1));struct.pack_into('<I',b,20,20000)
test('command_area_truncated',bytes(b),'load command cap')
b=bytearray(image(nsects=1));struct.pack_into('<I',b,36,176)
test('segment_declared_past_command_area',bytes(b),'load command range')
b=bytearray(image());struct.pack_into('<I',b,36,64)
test('segment_command_below_fixed_header',bytes(b),'segment command')
test('payload_file_truncated',image(truncate=1),'segment range')
# Scalar smoke tests of unchanged decoder, not a replacement for the original325 suite.
for fmt in (1,9,12):
    got=ns['decode_pointer'](0x38,fmt,0x100000000)
    result('decode_smoke_fmt'+str(fmt),0x38 if fmt==1 else 0x100000038,got['targetVA'])
# Source freeze verification occurs after all tested calls.
after={}
for k,p in INPUTS.items():
    b,after[k]=read_source(p); save(k+'.after.txt',b)
    result('frozen_'+k,True,b==raw[k] and before[k]==after[k])
save('after.json',json.dumps(after,indent=2))
passed=sum(r['pass'] for r in rows);failed=len(rows)-passed
summary={'passed':passed,'failed':failed,'total':len(rows),'exit':1 if failed else 0,'sourceSHA256':before['new15']['sha256'],'old14SHA256':before['old14']['sha256'],'rows':rows,'scope':'new15 four AST functions only; old14 AST comparison only; synthetic offline fixtures; no module/main/runtime/native/network parity','historical_limit':'Original failed14 harness/results not read per allowlist. Four failed14_family tests independently recreate three disjoint-table alias classes and missing section storage; exact original vector/name identity unverified.'}
save('results.json',json.dumps(summary,indent=2))
report=['# Independent new15 metadata guard test','',f"Results: {passed} PASS, {failed} FAIL, {len(rows)} named outcomes. Exit {summary['exit']}.",'',f"new15 SHA256: {summary['sourceSHA256']}",f"14 SHA256: {summary['old14SHA256']}",'','## Execution','CWD: /Volumes/D_Work/axiom2','Interpreter: /usr/bin/python3 -B; minimal env recorded in commands.txt.',f'Python: {sys.version}', 'CPU hard/soft15s, wall alarm60s, per-file4MiB, output aggregate16MiB checked before writes. One run; no retry.','AST execution namespace initially contains struct only (plus Python-injected builtins); only unpack_at, metadata, decode_pointer, walk_chains compiled. No original module imports or top-level execution.','Inputs copied before and after, stable-stat + SHA checked. SDK header copied completely with license.','', '## Contract and limitations','Acceptance means supported by these offline functions, not universal Mach-O validity. Disjointness excludes empty intervals and permits abutting endpoints. Empty pageStarts/no record offsets produce no walk rows. Section tests validate storage only, not section content semantics.','Header overlap attempts fail fixups header offsets before pairwise checks; record/header overlap is structurally excluded by starts>=28 and relative>=index size.',summary['historical_limit'],'No original325 regression run here; no cumulative totals. No real binaries/snapshot/settings/credentials/network/shim reads, no 14 execution, no main. Main must wait for matching independent reports.','','## Named actual / expected / guard outcomes']
for r in rows:report.append(f"- {'PASS' if r['pass'] else 'FAIL'} `{r['name']}`: expected `{r['expected']}`; actual `{r['actual']}`. Details in results.json.")
report+=['','## Files','results.json contains full per-case fixture SHA, metadata/roots/walk outputs and expected/actual outcomes. fixtures/ holds every synthetic input. source.diff records the exact two source guard edits. *.before.txt/*.after.txt and before.json/after.json bind all permitted source files. stdout.log/stderr.log preserve raw streams; exit-status.txt preserves process status. inventory.json lists final files and hashes (excluding itself).']
save('REPORT.md','\n'.join(report)+'\n')
print(json.dumps({k:v for k,v in summary.items() if k!='rows'}),flush=True)
signal.alarm(0)
sys.exit(summary['exit'])
