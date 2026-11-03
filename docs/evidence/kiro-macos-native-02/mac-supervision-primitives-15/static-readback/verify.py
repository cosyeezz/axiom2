import os,sys,pathlib,hashlib,json,re,struct,resource,signal,time
resource.setrlimit(resource.RLIMIT_CPU,(15,15))
resource.setrlimit(resource.RLIMIT_FSIZE,(16*1024*1024,16*1024*1024))
signal.alarm(60)
start=time.monotonic()
root=pathlib.Path('/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02').resolve()
out=pathlib.Path('/tmp/axiom-readback-p0t82s')
checks=[]; inventory={}; total=0

def check(name,ok,detail):
    checks.append({'check':name,'pass':bool(ok),'detail':detail})
def read(p):
    global total
    p=pathlib.Path(p)
    if p not in inventory:
        assert p.is_file() and p.stat().st_size<2*1024*1024, str(p)
        b=p.read_bytes(); total+=len(b); assert total<16*1024*1024
        inventory[p]={'path':str(p),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
    return p.read_bytes()
def load(p): return json.loads(read(p))
files=['README.md','mac-supervision-primitives-09/SUMMARY.md']
for case,names in {10:['EXPERIMENT.md','SUMMARY.md','locate_bootout.py','preserve_failure.py','preserve_pure_tests.py'],11:['EXPERIMENT.md','SUMMARY.md','locate_callers.py'],12:['EXPERIMENT.md','SUMMARY.md','locate_wrapper_callers.py'],13:['EXPERIMENT.md','SUMMARY.md','capture_tool_help.py'],14:['EXPERIMENT.md','locate_fixups.py']}.items():
    files += [f'mac-supervision-primitives-{case:02}/{n}' for n in names]
allowed=(root.parent/'kiro-macos-native-01/FAILURE.md').resolve()
link_count=0
for rel in files:
    p=root/rel; b=read(p); text=b.decode('utf-8')
    trailing=[i for i,l in enumerate(text.splitlines(),1) if l.endswith((' ','\t'))]
    check('whitespace '+rel,not trailing and b.endswith(b'\n'),{'trailingLines':trailing,'finalLF':b.endswith(b'\n')})
    if p.suffix!='.md': continue
    # These authored documents use inline links. Fail closed on unsupported reference syntax.
    check('link syntax '+rel,not re.search(r'^\s*\[[^\]]+\]:|\]\[[^\]]*\]',text,re.M),'inline links only; no reference-style links')
    links=re.findall(r'!?\[[^\]\n]*\]\(([^\n]*?)\)',text)
    for dest in links:
        raw=dest.strip()
        if raw.startswith('<') and raw.endswith('>'): raw=raw[1:-1]
        if re.match(r'^[A-Za-z][A-Za-z0-9+.-]*:',raw):
            check('external URL '+rel,False,raw); continue
        from urllib.parse import unquote
        targetpart=unquote(raw.split('#',1)[0].split('?',1)[0])
        target=(p.parent/targetpart).resolve() if targetpart else p.resolve()
        scope=target.is_relative_to(root) or target==allowed
        exists=target.exists() if scope else False
        check('link '+rel,scope and exists,{'destination':raw,'resolved':str(target),'scope':scope,'exists':exists,'contentRead':False})
        link_count+=1

def artifacts(case,dirname):
    d=root/f'mac-supervision-primitives-{case:02}'/dirname
    m=load(d/'manifest.json')
    for a in m['artifacts']:
        p=d/a['name']; assert p.parent==d and p.resolve().is_relative_to(d.resolve())
        b=read(p)
        check(f'{case} artifact '+a['name'],len(b)==a['bytes'] and hashlib.sha256(b).hexdigest()==a['sha256'],inventory[p])
    return d,m

d11,m11=artifacts(11,'results'); pre11=load(d11/'preflight.json')
check('11 preflight vs manifest',all(m11[k]==v for k,v in pre11.items() if k not in ['calls','functions']), 'all shared preflight metadata except post-run calls/functions')
helper=root/'mac-supervision-primitives-10/locate_bootout.py'
check('11/12 helper binding',inventory[helper]['sha256']==m11['helperSHA256'],'hash only; no old10 tests/inventory')
carrier=read(d11/'01-caller.macho')
# Interpret only the synthetic carrier's Mach-O load-command/section metadata, never a real image.
magic,cpu,sub,ft,ncmds,sz,flags,res=struct.unpack_from('<8I',carrier,0)
sections=[]; off=32
for _ in range(ncmds):
    cmd,cmdsize=struct.unpack_from('<II',carrier,off)
    assert cmdsize>=8 and off+cmdsize<=len(carrier)
    if cmd==0x19:
        ns=struct.unpack_from('<I',carrier,off+64)[0]
        for j in range(ns):
            sec=off+72+j*80
            name,seg,va,size,fo=struct.unpack_from('<16s16sQQI',carrier,sec)
            sections.append((name.rstrip(b'\0'),va,size,fo))
    off+=cmdsize
code_sections=[s for s in sections if s[0]==b'__text']
assert len(code_sections)==1
_,va,size,fo=code_sections[0]; body=carrier[fo:fo+size]
f=m11['functions'][0]
check('11 synthetic 44B code/bodySHA',magic==0xfeedfacf and size==44 and len(body)==44 and va==0x10000f60c and hashlib.sha256(body).hexdigest()==f['sourceBytesSHA256'],{'codeOffset':fo,'VA':hex(va),'bytes':size,'sha256':hashlib.sha256(body).hexdigest()})
asm=read(d11/'01-caller.stdout').decode(); rows=[]
for line in asm.splitlines():
    mt=re.match(r'^([0-9a-f]{16})\s+(.+)$',line)
    if mt: rows.append((int(mt[1],16),' '.join(mt[2].split())))
expected=['pacibsp','stp x29, x30, [sp, #-0x10]!','mov x29, sp','mov w1, #0x0','bl 0x100058988','cmn w0, #0x1','b.eq 0x10000f630','ldp x29, x30, [sp], #0x10','retab','bl 0x10005782c','b 0x10000f628']
check('11 ASM sequential addresses/expected semantics',rows==[(va+i*4,s) for i,s in enumerate(expected)],{'rows':rows,'interpretation':'flags0; BL importstub; return compared to -1; helper identity/errno unknown'})
words=struct.unpack('<11I',body)
def branch_target(addr,w):
    imm=w&0x3ffffff
    if imm&(1<<25): imm-=1<<26
    return addr+imm*4
check('11 body flags0 and BLstub',words[3]==0x52800001 and words[4]>>26==0x25 and branch_target(va+16,words[4])==0x100058988 and branch_target(va+36,words[9])==0x10005782c,{'movW1Word':hex(words[3]),'stubTarget':hex(branch_target(va+16,words[4]))})
check('11 original child record',len(m11['calls'])==1 and m11['calls'][0]['pid']==39799 and m11['calls'][0]['exit']==0 and m11['calls'][0]['timedOut'] is False,'record readback only; no command execution')
d12,m12=artifacts(12,'results'); pre12=load(d12/'preflight.json')
check('12 preflight vs manifest',all(m12[k]==v for k,v in pre12.items()),'all preflight keys identical')
check('12 helper binding',m12['helperSHA256']==inventory[helper]['sha256'],'hash only')
check('12 wrapper distinct from real import',m12['selectedWrapperVA']==0x10000f60c and m12['selectedImportStubs'][0]['va']==0x100058988 and m12['selectedWrapperVA']!=m12['selectedImportStubs'][0]['va'],'wrapper != import stub')
for field in ['directBranchHits','functionRanges','calls','functions']:
    check('12 empty '+field,m12[field]==[] and pre12[field]==[], 'bounded negative only; no reachability conclusion')
d13,m13=artifacts(13,'tool-help')
check('13 original usage child record',m13['argv']==['/usr/bin/dyld_info','-help'] and m13['pid']==42156 and m13['exit']==72 and m13['timedOut'] is False and m13['stage']=='usage_only_no_target','original child72, not driver0')
check('13 stdout/stderr exact',read(d13/'stdout')==b'' and read(d13/'stderr')==b"xcode-select: Failed to locate 'dyld_info', requesting installation of command line developer tools.\n",'stdout0B/stderr101B; installation requested; UI state unknown')
s13=read(root/'mac-supervision-primitives-13/SUMMARY.md').decode()
check('13 doc preserves limits',all(s in s13 for s in ['Driver exit0','not usable help','whether an installer UI was opened is not observed','No installation was approved']),'driver success is evidence recording, not usable help; no UI inference')
for n,m in [(11,m11),(12,m12),(13,m13)]:
    check(f'{n} recorded execution limits',all(m[k]==0 for k in ['targetRuns','controlCalls','modelRequests']),'recorded zeros, not runtime revalidation')
failed=[c for c in checks if not c['pass']]
summary={'status':'PASS' if not failed else 'FAIL','checks':len(checks),'failed':len(failed),'authoredFiles':len(files),'localLinks':link_count,'seconds':time.monotonic()-start,'inputBytes':total}
(out/'results.json').write_text(json.dumps({'summary':summary,'checks':checks},ensure_ascii=False,indent=2)+'\n')
(out/'input-inventory.json').write_text(json.dumps(list(inventory.values()),indent=2)+'\n')
command=f'/usr/bin/env -i HOME={out}/home TMPDIR={out}/tmp PATH=/usr/bin:/bin LC_ALL=C /usr/bin/python3 -I -B {out}/verify.py'
report=['# Independent bounded static readback', '',json.dumps(summary), '', 'CWD: /Volumes/D_Work/axiom2', 'Exact command: `'+command+'`', 'Verifier exit: '+str(bool(failed)*1), '', '## Scope/limits','Only own verifier executed; repository Python read/hash only. Real snapshot, system binaries, credentials never read. Link targets stat/existence only; root evidence02 with sole sibling exception ../kiro-macos-native-01/FAILURE.md. No runtime/unit/otool/shim/network/target calls. Old09 report inventories, old10 pure tests and unchanged prior passed checks not rerun. Main14 source read/hash/whitespace only, no tests. Local-link fragments not validated (existence/scope only). Manifest-reported source image/tool identities not independently rehashed. Driver0 from authored13 summary, not independently recorded driver process artifact. Synthetic carrier never executed. -1 helper identity remains unknown; UI state unknown.','','## Per-check results']
report += [('PASS ' if c['pass'] else 'FAIL ')+c['check']+' — '+json.dumps(c['detail'],ensure_ascii=False) for c in checks]
report += ['', '## Input hashes', 'See input-inventory.json (all inspected docs/source/new11–13 artifacts).','Resource limits: wall alarm60s, CPU15s, file16MiB; total output inventory checked by wrapper.']
(out/'REPORT.md').write_text('\n'.join(report)+'\n')
print(json.dumps(summary)); print('REPORT '+str(out/'REPORT.md'))
sys.exit(1 if failed else 0)
