try:
    import os,sys,json,hashlib,resource,signal,time,types,struct
    from pathlib import Path
    R=Path(__file__).parent
    resource.setrlimit(resource.RLIMIT_CPU,(2,3))
    resource.setrlimit(resource.RLIMIT_CORE,(0,0))
    resource.setrlimit(resource.RLIMIT_FSIZE,(65536,65536))
    resource.setrlimit(resource.RLIMIT_NOFILE,(32,32))
    signal.alarm(5)
    NAMES=['adrp_signed','adrp_reject','add_shift','add_reject','uleb_valid','uleb_shape','uleb_range','uleb_overflow','uleb_terminator','read_correct','read_reject','scan_four_bounds','scan_window','scan_cap']
    count=0
    cases=[]
    stage='startup'
    def ck(b):
        global count
        count+=1
        if not b: raise AssertionError()
    def bad(f,*a):
        try:f(*a)
        except ValueError:ck(True);return
        ck(False)
    def case(n,f):
        global stage
        stage=n
        before=count;f();cases.append({'name':n,'assertions':count-before})
    def run():
        global stage
        stage='environment'
        expected={'HOME','TMPDIR','TMP','TEMP','PATH','LANG'}
        extras={'CPATH','LC_CTYPE','LIBRARY_PATH','MANPATH','SDKROOT','__CF_USER_TEXT_ENCODING'}
        actual=set(os.environ)
        env={'expectedSixPresent':expected<=actual,'onlyDocumentedExtras':actual<=expected|extras,'actualKeyCount':len(actual),'platformExtraCount':len(actual-expected)}
        if not env['expectedSixPresent'] or not env['onlyDocumentedExtras']:raise ValueError()
        stage='source-bind'
        raw=(R/'source.py').read_bytes()
        if len(raw)!=8114 or hashlib.sha256(raw).hexdigest()!='bb5c054173e3aaf6574a1a8db190be415e1bceb08a1728386420e953e5f53e2f':raise ValueError()
        m=types.ModuleType('synthetic_xref');exec(compile(raw,str(R/'source.py'),'exec'),m.__dict__)
        def adrp_signed():
            for word,pc,page,reg in [(0x90000000,0x123abc,0x123000,0),(0xb0000001,0x123abc,0x124000,1),(0xd0000002,0x123abc,0x125000,2),(0xf0000003,0x123abc,0x126000,3),(0xf0ffffe4,0x123abc,0x122000,4),(0x90800005,0x200000000,0x100000000,5),(0xf07fffe6,0x200000000,0x2fffff000,6)]:ck(m.adrp(word,pc)==(page,reg))
        case(NAMES[0],adrp_signed)
        def adrp_reject():
            for word in [0x10000000,0x9000001f,0xd503201f,0x91000000,0x00000000]:ck(m.adrp(word,0x1000) is None)
        case(NAMES[1],adrp_reject)
        def add_shift():
            for word,page,reg,want in [(0x91000001,0x1000,0,0x1000),(0x913ffc01,0x1000,0,0x1fff),(0x91400401,0x1000,0,0x2000),(0x917ffc01,0x1000,0,0x1000000),(0x91000c43,0x8000,2,0x8003)]:ck(m.add_address(word,page,reg)==want)
        case(NAMES[2],add_shift)
        def add_reject():
            for w,reg in [(0x11000401,0),(0xd1000401,0),(0xb1000401,0),(0x91000441,0),(0x9100041f,0),(0x910007e1,31),(0x91800401,0)]:ck(m.add_address(w,0x1000,reg) is None)
        case(NAMES[3],add_reject)
        def uleb_valid():
            ck(m.function_starts(b'\x80\x02\x04\x00',0,0x100,0x200)==[0x100,0x104])
            ck(m.function_starts(b'\x01\x7f\x80\x01\x00\x00',0,1,0x200)==[1,128,256])
            ck(m.function_starts(b'\x10\x00',0x1000,0x1010,0x1020)==[0x1010])
        case(NAMES[4],uleb_valid)
        def uleb_shape():
            for args in [(b'',0,0,2),(bytearray(b'\x01\x00'),0,0,2),(b'\x00',0,0,2),(b'\x01\x00',2,1,3),(b'\x01\x00',0,1,1),(b'\x01\x00',0,2,1)]:bad(m.function_starts,*args)
        case(NAMES[5],uleb_shape)
        def uleb_range():
            for args in [(b'\x01\x00',0,2,4),(b'\x04\x00',0,1,4),(b'\x02\x02\x00',0,1,4)]:bad(m.function_starts,*args)
            ck(m.function_starts(b'\x03\x00',0,1,4)==[3])
        case(NAMES[6],uleb_range)
        def uleb_overflow():
            bad(m.function_starts,b'\x80'*9+b'\x02\x00',0,1,1<<80)
            bad(m.function_starts,b'\x80'*10+b'\x01\x00',0,1,1<<80)
            ck(m.function_starts(b'\xff'*9+b'\x01\x00',0,1,1<<64)==[(1<<64)-1])
        case(NAMES[7],uleb_overflow)
        def uleb_terminator():
            for raw in [b'\x01',b'\x80',b'\x01\x00\x01',b'\x81\x00\x00',b'\x01\x80\x00',b'\x01\x80'] :bad(m.function_starts,raw,0,1,512)
        case(NAMES[8],uleb_terminator)
        fd=os.open(str(R/'tiny.bin'),os.O_RDWR|os.O_CREAT|os.O_EXCL,0o600)
        os.write(fd,b'abcdefghij');before=os.fstat(fd)
        try:
            def read_correct():
                ck(m.read_at(fd,0,3)==b'abc');ck(m.read_at(fd,4,3)==b'efg');ck(m.read_at(fd,9,1)==b'j');ck(m.read_at(fd,0,10)==b'abcdefghij')
            case(NAMES[9],read_correct)
            def read_reject():
                for off,length in [(9,2),(10,1),(-1,1),(0,0),(True,1),(0,True),(0,m.TEXT_SIZE+1)]:bad(m.read_at,fd,off,length)
            case(NAMES[10],read_reject)
            after=os.fstat(fd)
            tiny={'size':after.st_size,'stable':m.stable(before)==m.stable(after),'regular':__import__('stat').S_ISREG(after.st_mode),'owned':after.st_uid==os.getuid()}
        finally:os.close(fd)
        original=(m.TEXT_VA,m.ANCHORS)
        try:
            va=0x100000;m.TEXT_VA=va;m.ANCHORS={'field':0x102011,'required':0x102022,'flag':0x102033,'format':0x102044}
            # Literal opcodes, not assembled by the implementation under test.
            words=[0xd0000000,0x91004401,0xd0000002,0x91008843,0xd0000004,0x9100cc85,0xd0000006,0x910110c7]
            text=struct.pack('<8I',*words)
            def scan_four_bounds():
                c,h,p=m.scan(text,[va,va+16]);ck(c==dict.fromkeys(m.ANCHORS,1));ck(len(h)==4);ck(p==4)
                ck([x['anchor'] for x in h]==list(m.ANCHORS));ck([x['target'] for x in h]==['0x102011','0x102022','0x102033','0x102044'])
                ck(all(x['functionStart']==hex(va) and x['upperBound']==hex(va+16) and x['boundIsNextStart'] for x in h[:2]))
                ck(all(x['functionStart']==hex(va+16) and x['upperBound']==hex(va+32) and not x['boundIsNextStart'] for x in h[2:]))
                ck(m.scan(text,[va+4])[0]['field']==0)
                ck(m.scan(text,[va,va+4])[0]['field']==0)
            case(NAMES[11],scan_four_bounds)
            def scan_window():
                a=struct.pack('<10I',words[0],*([0xd503201f]*7),words[1],0xd503201f)
                b=struct.pack('<10I',words[0],*([0xd503201f]*8),words[1])
                ck(m.scan(a,[va])[0]['field']==1);ck(m.scan(b,[va])[0]['field']==0)
                ck(m.scan(struct.pack('<2I',0xd000001f,words[1]),[va])[2]==0)
            case(NAMES[12],scan_window)
            def scan_cap():
                c,h,p=m.scan(text*18,[va]);ck(c==dict.fromkeys(m.ANCHORS,17));ck(len(h)==64);ck(p==72)
                ck(all(sum(x['anchor']==n for x in h)==16 for n in m.ANCHORS))
                ck(all(x['syntacticOnly'] is True for x in h));ck(all(x['upperBound']==hex(va+len(text)*18) for x in h))
            case(NAMES[13],scan_cap)
        finally:m.TEXT_VA,m.ANCHORS=original
        stage='publish'
        if len(cases)!=14 or count>96:raise ValueError()
        return {'status':'pass','cases':cases,'assertions':count,'environment':env,'tinyFD':tiny,'ramRestored':m.TEXT_VA==original[0] and m.ANCHORS is original[1],
            'runtime':{'version':list(sys.version_info[:3]),'platform':sys.platform,'machine':os.uname().machine},
            'limits':{k:list(resource.getrlimit(v)) for k,v in [('cpu',resource.RLIMIT_CPU),('core',resource.RLIMIT_CORE),('fsize',resource.RLIMIT_FSIZE),('nofile',resource.RLIMIT_NOFILE)]}}
    try:
        out=run()
        encoded=(json.dumps(out,sort_keys=True,separators=(',',':'))+'\n').encode()
        if len(encoded)>8192:raise ValueError()
        os.write(1,encoded)
    except BaseException:
        failure={'status':'unit-failed','phase':stage,'completedNamedCases':len(cases),'assertionsAttempted':count}
        os.write(1,(json.dumps(failure,separators=(',',':'))+'\n').encode());sys.exit(1)

except SystemExit:
    raise
except BaseException:
    try:
        os.write(1,b'{"status":"unit-failed","phase":"startup","completedNamedCases":0,"assertionsAttempted":0}\n')
    except BaseException:
        pass
    raise SystemExit(1)
