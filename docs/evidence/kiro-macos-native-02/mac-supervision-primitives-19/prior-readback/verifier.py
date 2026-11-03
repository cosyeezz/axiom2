import ast,hashlib,json,os,re,resource,signal,stat,struct,sys
from pathlib import Path
resource.setrlimit(resource.RLIMIT_CPU,(15,15))
resource.setrlimit(resource.RLIMIT_FSIZE,(4194304,4194304))
signal.alarm(60)
O=Path('/tmp/new18-independent.4t9BllXr'); R=Path('/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02'); B=R/'mac-supervision-primitives-18'
checks=[]; inputs={}; cache={}
def sha(x): return hashlib.sha256(x).hexdigest()
def check(n,v,d=None): checks.append({'name':n,'pass':bool(v),'detail':d})
def read(p):
 p=Path(p)
 if p in cache:return cache[p]
 assert not p.is_symlink() and p.is_file()
 b=p.read_bytes(); assert len(b)<=4194304
 inputs[str(p)]={'bytes':len(b),'sha256':sha(b)};cache[p]=b;return b
def js(p):return json.loads(read(p),object_pairs_hook=unique,parse_constant=lambda x: (_ for _ in ()).throw(ValueError(x)))
def unique(pairs):
 d={}
 for k,v in pairs:
  if k in d:raise ValueError('duplicate JSON key')
  d[k]=v
 return d
def save(n,x):
 with (O/n).open('x') as f:json.dump(x,f,indent=2);f.write('\n')
def text(p):return read(p).decode('utf-8')
try:
 authored=['EXPERIMENT.md','SUMMARY.md','PRIOR-READBACK-NOTE.md','inspect_callback_callee.py','preserve_prior.py']
 for n in authored:
  t=text(B/n);check(n+' UTF8/single finalLF',t.endswith('\n') and not t.endswith('\n\n') and '\r' not in t)
  check(n+' no trailing whitespace',all(s==s.rstrip() for s in t.splitlines()))
  links=re.findall(r'\[[^\]]*\]\(([^)]+)\)',t)
  for l in links:
   p=(B/l.split('#')[0]).resolve();check(n+' link '+l,(p.is_relative_to(R) or p==R.parent/'FAILURE.md') and p.is_file())
 driver=text(B/'inspect_callback_callee.py');tree=ast.parse(driver)
 check('driver SHA256',sha(read(B/'inspect_callback_callee.py'))=='4cb7385b3294a78f4d4e6ab9f780a5704282ae1b146f81f154a0c80811b438d7')
 ast.parse(text(B/'preserve_prior.py'))
 main=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='main')
 assign={}
 for n in ast.walk(main):
  if isinstance(n,ast.Assign):
   for t in n.targets:
    if isinstance(t,ast.Name):assign[t.id]=n
 funcs=next(n for n in ast.walk(main) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Tuple) for t in n.targets) and 'functions, constants' in ast.get_source_segment(driver,n))
 check('AST selected four functions/two constants',ast.literal_eval(funcs.value.elts[0])=={'signed','parse','make_carrier','direct_branches'} and ast.literal_eval(funcs.value.elts[1])=={'LITERAL','IMPORT'})
 nodesrc=ast.get_source_segment(driver,assign['nodes']);check('AST selection whitelist only',all(x in nodesrc for x in ['ast.FunctionDef','n.name in functions','ast.Assign','len(n.targets) == 1','ast.Name','n.targets[0].id in constants']))
 check('AST exactly six gate before selected exec',driver.index("if len(nodes) != 6")<driver.index('exec(compile(ast.Module(body=nodes'))
 check('only exec operates on selected AST',len([n for n in ast.walk(tree) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='exec'])==1)
 check('preflight saved before exact-entry/8192 gate',driver.index("save(out / 'preflight.json'")<driver.index('if not 0 < size <= 8192')<driver.index("write(out / 'function.bin'"))
 check('exact entry and section containment gate',"text['va'] <= start == TARGET and TARGET + 4 <= end <= text['va'] + text['size']" in driver)
 check('unknown rows fail closed',"instruction.startswith('.') or 'unknown' in instruction.lower()" in driver and 'if not tool_ok or not contiguous or unknown:' in driver and "raise ValueError('disassembly failed/incomplete/unknown; no retry')" in driver)
 check('CreateNew results/streams/output',"out.mkdir(mode=0o700)" in driver and "path.open('xb')" in driver and "open('xb') as stdout" in driver)
 check('single static otool invocation',driver.count('subprocess.Popen(')==1 and "argv = ['/usr/bin/otool', '-tv', str(carrier)]" in driver)
 m=js(B/'results/manifest.json');pre=js(B/'results/preflight.json')
 check('manifest extends identical preflight',all(m.get(k)==v for k,v in pre.items()))
 check('range and exact-entry/cap',m['range']=={'startVA':0x1000139b8,'endVA':0x100013a6c,'bytes':180} and m['targetIsFunctionStart'] is True and m['functionByteCap']==8192)
 check('main raw exit/stderr',read(B/'main.exit')==b'0\n' and read(B/'main.stderr')==b'')
 check('main namespace',text(B/'main-workdir.txt').strip()=='/tmp/new18-main.r7eWvl3G')
 out=js(B/'main.stdout');check('main stdout manifest consistent',out=={'status':m['status'],'range':m['range'],'words':m['decodedWordCount'],'bodySHA256':m['bodySHA256'],'toolExit':m['tool']['exit'],'unknownOpcodes':len(m['unknownOpcodeRows'])})
 check('historical tool metadata only',m['tool']['pid']==61691 and m['tool']['exit']==0 and m['tool']['timeout'] is False and abs(m['tool']['wallSeconds']-.048930084)<1e-12 and m['tool']['stdoutBytes']==1717 and m['tool']['stderrBytes']==0)
 check('no target/control/model claimed',all(m[k]==0 for k in ['targetRuns','controlCalls','modelRequests']))
 check('artifact inventory exact paths',{v['path'] for v in m['artifacts']}=={'preflight.json','function.bin','function.macho','disassembly.stdout','disassembly.stderr'} and len(m['artifacts'])==5)
 for a in m['artifacts']:
  p=B/'results'/a['path'];b=read(p);check('artifact seal '+a['path'],len(b)==a['bytes'] and sha(b)==a['sha256'] and stat.S_IMODE(p.stat().st_mode)==0o400)
 check('manifest mode0400',stat.S_IMODE((B/'results/manifest.json').stat().st_mode)==0o400)
 body=read(B/'results/function.bin');carrier=read(B/'results/function.macho')
 check('body 180B/SHA/offset',len(body)==180 and sha(body)==m['bodySHA256']=='a4f93f643d50e8bdd12c53fcfe72a41e478591d64d9dc3932224fda63b336c1c' and m['bodyFileOffset']==702904)
 check('carrier 364B/body',len(carrier)==364 and carrier[184:]==body)
 check('carrier complete ARM64e header',struct.unpack_from('<8I',carrier)==(0xfeedfacf,0x100000c,0x80000002,1,1,152,0,0))
 check('carrier complete segment',struct.unpack_from('<II16sQQQQiiII',carrier,32)==(25,152,b'__TEXT'+b'\0'*10,0x1000139b8,180,184,180,7,5,1,0))
 check('carrier complete section',struct.unpack_from('<16s16sQQIIIIIIII',carrier,104)==(b'__text'+b'\0'*10,b'__TEXT'+b'\0'*10,0x1000139b8,180,184,2,0,0,0x80000400,0,0,0))
 asm=text(B/'results/disassembly.stdout');rows=[(int(v,16),s) for v,s in re.findall(r'^([0-9a-fA-F]{16})\s+(.+)$',asm,re.M)]
 check('45 contiguous addresses/no unknowns',len(rows)==45 and [v for v,s in rows]==list(range(0x1000139b8,0x100013a6c,4)) and all(not s.startswith('.') and 'unknown' not in s.lower() for v,s in rows) and m['decodedWordCount']==45 and m['contiguousWordAddresses'] is True and m['unknownOpcodeRows']==[])
 check('no local callback BR/BLR ASM',all(not re.match(r'(?:blr|br)(?:a[a-z]*)?\b',s) for v,s in rows))
 words=struct.unpack('<45I',body)
 check('no local register branch BR/BLR encoding',all((w&0xfffffc1f) not in (0xd61f0000,0xd63f0000) for w in words))
 decoded=[]
 for va,rd,rm in [(0x1000139d8,19,4),(0x1000139fc,21,0),(0x100013a4c,0,21)]:
  w=words[(va-0x1000139b8)//4];ok=(w&0xffe0ffe0)==0xaa0003e0 and (w&31)==rd and ((w>>16)&31)==rm
  decoded.append({'va':hex(va),'word':hex(w),'MOVrd':rd,'MOVrm':rm});check('independent MOV '+hex(va),ok)
 w=words[(0x100013a48-0x1000139b8)//4];imm=(w>>15)&127;imm=imm-128 if imm&64 else imm
 check('independent STP xzr,x19 x21 offset40 second48',(w&0xffc00000)==0xa9000000 and w&31==31 and (w>>10)&31==19 and (w>>5)&31==21 and imm*8==64 and imm*8+8==72)
 decoded.append({'va':'0x100013a48','word':hex(w),'base':21,'first':31,'second':19,'offset':imm*8,'secondOffset':imm*8+8});save('decode.json',decoded)
 # Only two authorized snapshot windows; no snapshot whole/slice hash.
 snap=R/'mac-supervision-primitives-08/capture/launchd.snapshot'
 with snap.open('rb') as f:
  for off,size in [(702904,180),(1181168,2496)]:
   f.seek(off);b=f.read(size);inputs[str(snap)+'@'+str(off)+'+'+str(size)]={'bytes':len(b),'sha256':sha(b)}
   if off==702904:check('snapshot selected body equality',b==body)
   else:startsraw=b
 starts=[];value=0;shift=0;cur=0x100000000;endpos=None
 for i,b in enumerate(startsraw):
  value|=(b&127)<<shift
  if b&128:shift+=7;assert shift<64;continue
  if value==0:endpos=i;break
  cur+=value;starts.append(cur);value=0;shift=0
 check('LC starts 1764/terminated/padding',len(starts)==1764 and endpos is not None and not any(startsraw[endpos:]) and starts==sorted(set(starts)))
 check('LC starts exact adjacent entry bounds',0x1000139b8 in starts and starts[starts.index(0x1000139b8)+1]==0x100013a6c)
 pres=js(B/'prior-preservation.json');P=B/'prior-readback';inv=js(P/'artifact-SHA256.json')
 check('prior inventory23/76158 + own2929',len(inv)==23 and sum(v['bytes'] for v in inv.values())==76158 and len(read(P/'artifact-SHA256.json'))==2929)
 check('prior24 total79087',len(pres['copies'])==24 and pres['fileCount']==24 and pres['bytes']==79087 and sum(v['bytes'] for v in pres['copies'])==79087)
 check('prior exact file set',set(p.name for p in P.iterdir())==set(inv)|{'artifact-SHA256.json'})
 for a in pres['copies']:
  p=B/a['destination'];assert p.parent==P
  b=read(p);check('new retained copy seal '+p.name,len(b)==a['bytes'] and sha(b)==a['sha256'] and a['mode']=='0400' and stat.S_IMODE(p.stat().st_mode)==0o400)
  if p.name in inv:check('inventory crossbinding '+p.name,inv[p.name]=={'bytes':len(b),'sha256':sha(b)})
 original=js(P/'checks.json');final=js(P/'final-checks.json');correction=js(P/'header-correction-checks.json')
 failed=[v for v in original if v['pass'] is not True];retained=[v for v in original if v['pass'] is True]
 check('prior169=168PASS+1 subtype oracle',len(original)==169 and len(retained)==168 and len(failed)==1 and failed[0]['name']=='carrier Mach-O64 ARM64e MH_OBJECT header')
 check('prior171 exact same168 plus3',len(correction)==3 and final==retained+correction and len(final)==171 and all(v['pass'] is True for v in correction))
 check('prior original1/correction0 streams',read(P/'verifier.exit')==b'1\n' and read(P/'header-correction.exit')==b'0\n' and read(P/'verifier.stderr')==b'' and read(P/'header-correction.stderr')==b'' and js(P/'verifier.stdout')==js(P/'summary.json') and js(P/'header-correction.stdout')==js(P/'final-summary.json'))
 # Retained verifier source is DATA only: no parsing/compiling/executing historic tests.
 v=text(P/'verifier.py');h=text(P/'header-correction.py');seal=text(P/'seal.py');note=text(B/'PRIOR-READBACK-NOTE.md')
 check('subtype oracle evidence', '0x100000c,2,1,1,152,0,0' in v.replace(' ','') and '0x80000002' in h)
 check('original report overwrite provenance',"(p/'REPORT.md').write_text" in h and 'overwrote' in note and 'not a separate raw copy' in note)
 check('seal.exit self-declared provenance',"(p/'seal.exit').write_text('0\\n')" in seal and 'self-declared artifact metadata' in note and 'not independent held-process exit evidence' in note)
 check('prior report final not initial', 'Final aggregate171/171' in text(P/'REPORT.md'))
except Exception as e:
 check('verifier unhandled error',False,repr(e))
save('checks.json',checks);save('input-SHA256.json',inputs)
summary={'checks':len(checks),'passed':sum(x['pass'] for x in checks),'failed':sum(not x['pass'] for x in checks),'cwd':os.getcwd(),'scope':'new18 delivery only; prior records data only; two snapshot windows only','repoExecution':0,'toolExecution':0}
save('summary.json',summary)
report='# Independent case18 delivery audit\n\n'+json.dumps(summary,indent=2)+'\n\nFailed checks: '+json.dumps([x for x in checks if not x['pass']],indent=2)+'\n\nStatic decoding supports incoming x4 saved in x19 and stored in second pair slot at returned pointer +0x48. No local callback BR/BLR in 45 saved rows. Fixed callees, runtime reachability, authorization, server parity and M3 unverified. Historical PID/exit/time are declarations checked against saved streams, not a new execution. Snapshot whole/slice identity inherited, not rehashed. No old tests/main/otool/helper execution or old source-copy rehash; no root/17/19 access (except the two explicitly authorized08 windows). No repo writes, network/control/model. Input SHA inventory includes only new18 and the two windows.\n'
with (O/'REPORT.md').open('x') as f:f.write(report)
print(json.dumps(summary));sys.exit(bool(summary['failed']))
