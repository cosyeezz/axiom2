import os, sys, json, hashlib, re, stat, struct, signal, resource, ast
from pathlib import Path
resource.setrlimit(resource.RLIMIT_CPU,(15,15))
resource.setrlimit(resource.RLIMIT_FSIZE,(4*1024*1024,4*1024*1024))
signal.alarm(60)
OUT=Path('/tmp/case17-delivery.phk2Y4Eb')
ROOT=Path('/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02')
CASE=ROOT/'mac-supervision-primitives-17'
checks=[]; inputs={}; links=[]; decode={}
def sha(b): return hashlib.sha256(b).hexdigest()
def check(name, ok, detail=None):
    checks.append({'name':name,'pass':bool(ok),'detail':detail})
def read(p):
    p=Path(p); s=p.lstat()
    if not stat.S_ISREG(s.st_mode) or s.st_size>4*1024*1024: raise ValueError('input type/cap '+str(p))
    b=p.read_bytes(); t=p.stat()
    if (s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)!=(t.st_ino,t.st_size,t.st_mtime_ns,t.st_ctime_ns): raise ValueError('changed input')
    inputs[str(p)]={'bytes':len(b),'sha256':sha(b),'mode':oct(stat.S_IMODE(s.st_mode))}
    return b
def pairs(rows):
    d={}
    for k,v in rows:
        if k in d: raise ValueError('duplicate JSON key')
        d[k]=v
    return d
def load(b): return json.loads(b,object_pairs_hook=pairs,parse_constant=lambda x: (_ for _ in ()).throw(ValueError(x)))
def save(name,obj): (OUT/name).write_text(json.dumps(obj,indent=2,ensure_ascii=False)+'\n')
def verify():
    texts=[ROOT/'README.md',CASE/'EXPERIMENT.md',CASE/'SUMMARY.md',CASE/'capture_containing_function.py',CASE/'preserve_prior.py']
    for p in texts:
        b=read(p); text=b.decode('utf-8'); label=str(p.relative_to(ROOT))
        check(label+': final LF exactly one', b.endswith(b'\n') and not b.endswith(b'\n\n'))
        check(label+': no CR/trailing whitespace', b'\r' not in b and all(line.rstrip(' \t')==line for line in text.splitlines()))
        if p.suffix=='.py':
            ast.parse(text); check(label+': AST syntax only (not compiled/executed)',True)
        else:
            for m in re.finditer(r'\[[^\]\n]*\]\(([^)\n]+)\)',text):
                target=m.group(1)
                dest=(p.parent/target.split('#')[0]).resolve()
                allowed=dest.is_relative_to(ROOT) or dest==ROOT.parent/'kiro-macos-native-01/FAILURE.md'
                ok=allowed and dest.exists()
                links.append({'file':label,'line':text.count('\n',0,m.start())+1,'target':target,'allowed':allowed,'exists':dest.exists()})
                check(label+': link '+target,ok)
    driver=read(CASE/'capture_containing_function.py')
    check('driver SHA exact',sha(driver)=='6ae56ce8795407c4d8870fe7325e0c174e2e3cec7c9ce1c8bd4643f7b0d6c744')
    manifest=load(read(CASE/'results/manifest.json')); pre=load(read(CASE/'results/preflight.json'))
    check('preflight all fields match manifest',all(manifest[k]==v for k,v in pre.items()))
    check('preflight driver binding',pre['driverSHA256']==sha(driver))
    check('exact function range/cap',pre['range']=={'startVA':0x10001f25c,'endVA':0x10001f2c4,'bytes':104} and pre['functionByteCap']==8192)
    check('body whole-file offset',manifest['bodyFileOffset']==750172)
    check('no target/control/model declared',all(manifest[k]==0 for k in ['targetRuns','controlCalls','modelRequests']))
    main=load(read(CASE/'main.stdout'))
    check('main stdout matches manifest', main=={'status':manifest['status'],'range':manifest['range'],'words':manifest['decodedWordCount'],'bodySHA256':manifest['bodySHA256'],'toolExit':manifest['tool']['exit'],'unknownOpcodes':len(manifest['unknownOpcodeRows'])})
    check('raw main exit0/stderr empty',read(CASE/'main.exit')==b'0\n' and read(CASE/'main.stderr')==b'')
    workdir=read(CASE/'main-workdir.txt').decode();check('own namespace declared',workdir.startswith('/tmp/') and workdir.endswith('\n'))
    expected_names={'preflight.json','function.bin','function.macho','disassembly.stdout','disassembly.stderr'}
    check('five manifest artifact names unique',len(manifest['artifacts'])==5 and {x['path'] for x in manifest['artifacts']}==expected_names)
    data={}
    for row in manifest['artifacts']:
        p=CASE/'results'/row['path']; b=read(p); data[row['path']]=b
        check('artifact '+row['path']+' SHA/size/0400',sha(b)==row['sha256'] and len(b)==row['bytes'] and stat.S_IMODE(p.stat().st_mode)==0o400)
    check('results exactly six files',{p.name for p in (CASE/'results').iterdir()}==expected_names|{'manifest.json'})
    check('manifest 0400',stat.S_IMODE((CASE/'results/manifest.json').stat().st_mode)==0o400)
    body=data['function.bin']; carrier=data['function.macho']
    check('body 104B exact SHA',len(body)==104 and sha(body)==manifest['bodySHA256']=='f1b1bb0c5dc5961f8a72e7d1bf91fd988e4daead652d8b763aca32f77d0fa282')
    check('carrier 288B body at184',len(carrier)==288 and carrier[184:]==body)
    header=struct.unpack_from('<8I',carrier)
    segment=struct.unpack_from('<II16sQQQQiiII',carrier,32)
    section=struct.unpack_from('<16s16sQQIIIIIIII',carrier,104)
    decode['carrier']={'header':header,'segment':[v.decode().rstrip('\0') if isinstance(v,bytes) else v for v in segment],'section':[v.decode().rstrip('\0') if isinstance(v,bytes) else v for v in section]}
    check('carrier Mach-O64 ARM64e MH_OBJECT header',header[:6]==(0xfeedfacf,0x100000c,2,1,1,152) and header[6:]==(0,0))
    check('carrier LC_SEGMENT64 maps body',segment[0:2]==(0x19,152) and segment[3:7]==(0x10001f25c,104,184,104) and segment[9]==1)
    check('carrier section text and body bounds',section[0].rstrip(b'\0')==b'__text' and section[1].rstrip(b'\0')==b'__TEXT' and section[2:6]==(0x10001f25c,104,184,2) and section[6:8]==(0,0) and section[8]==0x80000400)
    stdout=data['disassembly.stdout']; stderr=data['disassembly.stderr']
    rows=[(int(m[1],16),m[2]) for m in re.finditer(r'^([0-9a-fA-F]{16})\s+(.+)$',stdout.decode(),re.M)]
    check('26 contiguous word addresses',len(rows)==26 and [x[0] for x in rows]==list(range(0x10001f25c,0x10001f2c4,4)) and manifest['decodedWordCount']==26 and manifest['contiguousWordAddresses'] is True)
    check('no unknown rows reported/observed',manifest['unknownOpcodeRows']==[] and all(not t.startswith('.') and 'unknown' not in t.lower() for _,t in rows))
    tool=manifest['tool'];check('tool historical declaration only',tool['pid']==55396 and type(tool['exit']) is int and tool['exit']==0 and tool['timeout'] is False and tool['stdoutBytes']==len(stdout)==997 and tool['stderrBytes']==len(stderr)==0 and tool['argv']==['/usr/bin/otool','-tv',str(CASE/'results/function.macho')])
    # Read ONLY the authorized body and starts windows. No whole/slice read or hash.
    snapshot=ROOT/'mac-supervision-primitives-08/capture/launchd.snapshot'
    with snapshot.open('rb') as f:
        f.seek(750172); frozenbody=f.read(104)
        f.seek(1181168); stream=f.read(2496)
    inputs[str(snapshot)+'@750172+104']={'bytes':len(frozenbody),'sha256':sha(frozenbody)}
    inputs[str(snapshot)+'@1181168+2496']={'bytes':len(stream),'sha256':sha(stream)}
    check('selected frozen body equals result',frozenbody==body)
    starts=[]; i=0; va=0x100000000
    while i<len(stream):
        n=0; shift=0
        while True:
            c=stream[i];i+=1;n|=(c&127)<<shift;shift+=7
            if shift>63:raise ValueError('ULEB overflow')
            if c<128:break
        if n==0:break
        va+=n;starts.append(va)
    check('function starts stream count/termination',len(stream)==2496 and len(starts)==pre['startsCount']==1764 and all(x==0 for x in stream[i:]))
    idx=starts.index(0x10001f25c)
    check('function bounds adjacent in frozen starts',starts[idx+1]==0x10001f2c4 and 0x10001f25c<=pre['candidate']['va']<pre['candidate']['addVA']+4<=0x10001f2c4 and 0x10000f60c in starts)
    check('body offset from text mapping',pre['sliceOffset']+pre['text']['offset']+0x10001f25c-pre['text']['va']==750172)
    words=struct.unpack('<26I',body)
    at=lambda a:words[(a-0x10001f25c)//4]
    sign=lambda n,b:n-(1<<b) if n&(1<<(b-1)) else n
    a=at(0x10001f27c); b=at(0x10001f280)
    pages=sign(((a>>29)&3)|(((a>>5)&0x7ffff)<<2),21)
    page=(0x10001f27c&~4095)+(pages<<12); addimm=((b>>10)&4095)<<(12 if b&(1<<22) else 0)
    bl=at(0x10001f28c); dest=0x10001f28c+(sign(bl&0x3ffffff,26)<<2)
    decode.update({'ADRPword':hex(a),'ADDword':hex(b),'signedPages':pages,'page':hex(page),'ADDimm':addimm,'formed':hex(page+addimm),'PACIZAword':hex(at(0x10001f284)),'MOVword':hex(at(0x10001f288)),'BLword':hex(bl),'BLdestination':hex(dest),'functionStartCount':len(starts),'streamConsumedBytes':i})
    check('independent ADRP x16 / ADD x16,x16 to wrapper',a&0x9f00001f==0x90000010 and b&0xffc003ff==0x91000210 and pages==-16 and page+addimm==0x10000f60c)
    check('independent PACIZA x16 and MOV x4,x16 words',at(0x10001f284)==0xdac123f0 and at(0x10001f288)==0xaa1003e4)
    check('independent BL target 139b8',bl&0xfc000000==0x94000000 and dest==0x1000139b8)
    pres=load(read(CASE/'prior-preservation.json')); inv=load(read(CASE/'prior-readback/artifact-SHA256.json'))
    check('preservation manifest 0400',stat.S_IMODE((CASE/'prior-preservation.json').stat().st_mode)==0o400)
    check('22 newly preserved files aggregate',pres['fileCount']==len(pres['copies'])==22 and pres['bytes']==sum(x['bytes'] for x in pres['copies'])==67083)
    check('inventory 21 entries/64374B plus2709B',len(inv)==21 and sum(x['bytes'] for x in inv.values())==64374 and len(read(CASE/'prior-readback/artifact-SHA256.json'))==2709)
    check('preservation exact directory set',{x['destination'] for x in pres['copies']}=={'prior-readback/'+p.name for p in (CASE/'prior-readback').iterdir()} and len({x['destination'] for x in pres['copies']})==22)
    for row in pres['copies']:
        name=Path(row['destination']).name
        check('retained path '+name, row['destination']=='prior-readback/'+name and Path(row['source']).name==name)
        p=CASE/row['destination']; raw=read(p)
        check('retained '+name+' SHA/size/0400',len(raw)==row['bytes'] and sha(raw)==row['sha256'] and row['mode']=='0400' and stat.S_IMODE(p.stat().st_mode)==0o400)
        if name!='artifact-SHA256.json':check('inventory binding '+name,inv[name]=={'bytes':len(raw),'sha256':sha(raw)})
    retained=load(read(CASE/'prior-readback/checks.json')); attempt=load(read(CASE/'prior-readback/attempt1-checks.json'))
    check('historical 93 checks retained as data',len(retained)==93 and all(x['pass'] is True for x in retained) and pres['priorCheckCount']==pres['priorPassed']==93 and pres['priorFailed']==0)
    check('historical first harness1/final0',read(CASE/'prior-readback/attempt1-verifier.exit')==b'1\n' and read(CASE/'prior-readback/verifier.exit')==b'0\n' and len(attempt)==95 and sum(x['pass'] is True for x in attempt)==93)
    check('preservation no new runs declared',all(pres[k]==0 for k in ['newVerifierRuns','newLocatorRuns','targetRuns','controlCalls','modelRequests']))
try:
    verify()
except Exception as e:
    check('verifier unhandled exception',False,repr(e))
save('checks.json',checks);save('input-SHA256.json',inputs);save('links.json',links);save('decode.json',decode)
failed=[c for c in checks if not c['pass']]
summary={'checks':len(checks),'passed':len(checks)-len(failed),'failed':len(failed),'failedChecks':failed,'historicalChecksExecuted':0,'repoExecutions':0,'wholeSnapshotRehashed':False}
save('summary.json',summary)
(OUT/'REPORT.md').write_text('# Independent case17 delivery verification\n\n'+json.dumps(summary,indent=2)+'\n\nCWD: /Volumes/D_Work/axiom2. Own TEMP verifier only, CPU15s/wall60s/file4MiB/total16MiB. Repository read-only. Five authored texts checked; Python AST parse only, no compile/import/exec. Local links bounded to evidence02 and exact sibling FAILURE.md. Frozen snapshot read only at 750172+104 and 1181168+2496; whole/slice identity inherited from case16 and NOT rehashed. Tool PID/exit/timeout are historical declarations corroborated by retained streams, not a new tool execution. 22 newly retained prior16 audit files hashed; 93 checks treated as retained data, not rerun. No old22/earlier92 hashes, old tests/scans/main/otool, real binaries/config/credentials, shim/network/control/model, or case18 access.\n\nStatic x4 function-pointer argument only; callee invocation, reachability, authority, M3 and parity remain unproved. See checks.json, input-SHA256.json, decode.json, links.json, commands.txt, verifier.stdout/stderr/exit and artifact-SHA256.json.\n')
print(json.dumps(summary,indent=2));sys.exit(bool(failed))
