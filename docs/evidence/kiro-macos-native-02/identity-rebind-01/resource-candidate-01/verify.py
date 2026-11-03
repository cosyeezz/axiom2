import os, sys, json, hashlib, struct, resource, time
resource.setrlimit(resource.RLIMIT_CPU, (25,30))
out=os.path.dirname(os.path.abspath(__file__))
source='/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/kiro-mac-identity-rebind01-vni48j5_/kiro-cli-chat.macho'
meta='/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02/identity-rebind-01/verification.json'
expected_full='7f684ad558ea35de830086a6d44f3eff4835ce381b70c861f365c8842729b94f'
expected_range='c622372e59d8bf6f2fd84fda092c5a441b38922f4975326af7de6b4b5572f4ff'
r={'source':source,'metadata':meta,'scriptSha256':hashlib.sha256(open(__file__,'rb').read()).hexdigest(),'cliExecutions':0,'modelRequests':0,'networkRequests':0,'homeReads':0,'decompressions':0,'status':'error'}
rc=1
try:
    mb=open(meta,'rb').read(); m=json.loads(mb)
    r['metadataSha256']=hashlib.sha256(mb).hexdigest()
    entries=[x for x in m['inputs'] if x['snapshot']==source]
    assert len(entries)==1
    ent=entries[0]
    arm=[x for x in ent['macho']['slices'] if x['cpuType']=='0x100000c']
    assert len(arm)==1
    arm=arm[0]
    const=[x for x in arm['sections'] if x['segment']=='__TEXT' and x['section']=='__const']
    assert len(const)==1
    const=const[0]
    assert (arm['offset'],arm['bytes'],const['sliceOffset'],const['bytes'])==(215023616,198028304,73916416,112409560)
    fd=os.open(source,os.O_RDONLY | os.O_NOFOLLOW)
    try:
        st=os.fstat(fd)
        identity=lambda s: [s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns]
        r['identityBefore']=identity(st)
        assert st.st_size==413051920==ent['bytes']
        def get(pos,n):
            b=os.pread(fd,n,pos)
            if len(b)!=n: raise ValueError('short read')
            return b
        def digest(pos,n):
            h=hashlib.sha256()
            while n:
                b=get(pos,min(n,4*1024*1024)); h.update(b); pos+=len(b); n-=len(b)
            return h.hexdigest()
        r['fullSha256']=digest(0,st.st_size)
        assert r['fullSha256']==expected_full==ent['sha256'], 'full identity mismatch'
        magic,count=struct.unpack('>II',get(0,8)); assert magic==0xcafebabe and count<=16
        fat=[struct.unpack('>IIIII',get(8+i*20,20)) for i in range(count)]
        actual=[a for a in fat if a[0]==0x100000c]
        assert len(actual)==1 and actual[0][2:4]==(arm['offset'],arm['bytes'])
        base=arm['offset']; hdr=struct.unpack('<8I',get(base,32)); assert hdr[0]==0xfeedfacf
        commands=get(base+32,hdr[5]); p=0; sections=[]
        for _ in range(hdr[4]):
            cmd,size=struct.unpack_from('<II',commands,p)
            assert size>=8 and p+size<=len(commands)
            if cmd==0x19:
                n=struct.unpack_from('<I',commands,p+64)[0]
                assert 72+80*n<=size
                for i in range(n):
                    sec=struct.unpack_from('<16s16sQQIIIIIIII',commands,p+72+i*80)
                    if sec[0].rstrip(b'\0')==b'__const' and sec[1].rstrip(b'\0')==b'__TEXT':
                        sections.append((sec[4],sec[3]))
            p+=size
        assert p==len(commands) and sections==[(73916416,112409560)]
        rel=75706006; length=22001675; absolute=base+rel
        assert const['sliceOffset']<=rel and rel+length<=const['sliceOffset']+const['bytes']<=arm['bytes']
        r['candidate']={'sliceOffset':rel,'absoluteFileOffset':absolute,'bytes':length,'endExclusive':absolute+length,'sectionSliceOffset':const['sliceOffset'],'sectionBytes':const['bytes'],'withinSection':True,'expectedSha256':expected_range}
        head=get(absolute,32)
        with open(os.path.join(out,'candidate-head-32.bin'),'xb') as f: f.write(head)
        r['candidate']['head32Hex']=head.hex()
        r['candidate']['sha256']=digest(absolute,length)
        r['candidate']['matchesOldCompressed']=r['candidate']['sha256']==expected_range
        r['identityAfter']=identity(os.fstat(fd))
        assert r['identityBefore']==r['identityAfter'],'FD metadata changed'
        r['status']='matched_identical_compressed_resource_inclusion_only' if r['candidate']['matchesOldCompressed'] else 'candidate_hash_mismatch_no_scan_or_unpack'
        r['currentCallerUse']='not established; no pointer, reachability or runtime evidence'
        r['reuseOldSelectedPublicSourceAllowedByByteIdentity']=r['candidate']['matchesOldCompressed']
        rc=0 if r['candidate']['matchesOldCompressed'] else 2
    finally: os.close(fd)
except Exception as e:
    r['error']=type(e).__name__+': '+str(e)
r['exitCode']=rc
with open(os.path.join(out,'verification.json'),'x') as f: json.dump(r,f,indent=2); f.write('\n')
print(json.dumps(r,indent=2))
sys.exit(rc)
