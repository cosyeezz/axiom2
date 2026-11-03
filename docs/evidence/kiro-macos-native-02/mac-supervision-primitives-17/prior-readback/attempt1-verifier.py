import ast,hashlib,json,os,re,resource,signal,stat,struct,time,uuid
from pathlib import Path
resource.setrlimit(resource.RLIMIT_CPU,(15,15))
resource.setrlimit(resource.RLIMIT_FSIZE,(4*1024*1024,4*1024*1024))
signal.alarm(60)
t0=time.monotonic()
OUT=Path(os.environ['AUDIT']); ROOT=Path('/Volumes/D_Work/axiom2'); BASE=ROOT/'docs/evidence/kiro-macos-native-02'; C=BASE/'mac-supervision-primitives-16'
checks=[]; inputs={}
def check(name,ok,detail=None):
 checks.append({'name':name,'pass':bool(ok),'detail':detail})
def read(p):
 p=Path(p); a=p.stat(); assert stat.S_ISREG(a.st_mode) and a.st_size<=4*1024*1024
 raw=p.read_bytes(); b=p.stat(); assert (a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns)==(b.st_ino,b.st_size,b.st_mtime_ns,b.st_ctime_ns)
 inputs[str(p)]={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}; return raw
def js(p): return json.loads(read(p))
def save(n,v): (OUT/n).write_text(json.dumps(v,indent=2)+'\n')
texts={n:read(C/n) for n in ['EXPERIMENT.md','SUMMARY.md','locate_code_address.py','preserve_prior.py']}
links=[]
for name,raw in texts.items():
 s=raw.decode(); check(name+' final LF',raw.endswith(b'\n') and not raw.endswith(b'\n\n'))
 check(name+' whitespace',not any(line.rstrip(' \t')!=line or '\r' in line for line in s.split('\n')))
 for match in re.finditer(r'\[[^\]]*\]\(([^)]+)\)',s):
  dest=match.group(1); local=not re.match(r'^[a-zA-Z]+:',dest); target=C/dest.split('#')[0]
  if local: links.append({'file':name,'destination':dest,'exists':target.exists()}); check('local link '+dest,target.exists())
check('driver exact SHA',inputs[str(C/'locate_code_address.py')]['sha256']=='265197505a5a411b6ca3d46bf0db778bb8c31ec037f31efd7303a872832976b7')
h=read(BASE/'mac-supervision-primitives-10/locate_bootout.py'); check('helper exact SHA',hashlib.sha256(h).hexdigest()=='d0fac58e32092abaf2208646ccfcd4c6427d43f1edb46d79744e28f631ba7608')
# Parse only: no imported or compiled repository source.
tree=ast.parse(texts['locate_code_address.py']); ht=ast.parse(h)
selected=[n for n in ht.body if isinstance(n,ast.FunctionDef) and n.name in {'signed','parse','find_xrefs'} or isinstance(n,ast.Assign) and len(n.targets)==1 and isinstance(n.targets[0],ast.Name) and n.targets[0].id in {'LITERAL','IMPORT'}]
check('helper selected AST exact definitions',len(selected)==5,[getattr(n,'name',getattr(n.targets[0],'id',None)) if isinstance(n,ast.Assign) else n.name for n in selected])
s=texts['locate_code_address.py'].decode()
check('driver reuse selection exact scope',"functions = {'signed', 'parse', 'find_xrefs'}" in s and "constants = {'LITERAL', 'IMPORT'}" in s and "namespace = {'struct': struct, 'hashlib': hashlib, 'uuid': uuid}" in s and "len(nodes) != 5" in s)
check('no helper module import',not any(isinstance(n,(ast.Import,ast.ImportFrom)) and 'locate_bootout' in ast.unparse(n) for n in ast.walk(tree)))
raw=read(BASE/'mac-supervision-primitives-08/capture/launchd.snapshot')
check('whole snapshot identity',len(raw)==1236160 and hashlib.sha256(raw).hexdigest()=='7b636e967e77705d88aad9ad9ea9af627852d83686cd19ab4d94c6010cd67b09')
magic,count=struct.unpack_from('>II',raw); assert magic==0xcafebabe
choices=[]
for i in range(count):
 cpu,sub,off,size,align=struct.unpack_from('>IIIII',raw,8+20*i)
 if cpu==0x100000c and sub&0xffffff==2: choices.append((off,size))
check('unique ARM64e slice',choices==[(622592,613568)])
off,size=choices[0]; data=raw[off:off+size]
check('slice SHA',hashlib.sha256(data).hexdigest()=='fe9a1562d360e15c86937153586ca8778ee72bd95de423415ec780ebde9c0102')
header=struct.unpack_from('<8I',data); assert header[0]==0xfeedfacf and header[1]==0x100000c and header[2]&0xffffff==2
cursor=32; sections=[]; metadata={}
for i in range(header[4]):
 cmd,length=struct.unpack_from('<II',data,cursor); assert length>=8 and cursor+length<=32+header[5]
 if cmd==0x1b: metadata['uuid']=str(uuid.UUID(bytes=data[cursor+8:cursor+24])).upper()
 if cmd==0x26: metadata['starts']=struct.unpack_from('<II',data,cursor+8)
 if cmd==2: metadata['symbols']=struct.unpack_from('<4I',data,cursor+8)
 if cmd==0xb: metadata['indirect']=struct.unpack_from('<2I',data,cursor+56)
 if cmd==0x19:
  seg=struct.unpack_from('<II16sQQQQiiII',data,cursor)
  if seg[2].rstrip(b'\0')==b'__TEXT': metadata['base']=seg[3]
  for j in range(seg[9]):
   v=struct.unpack_from('<16s16sQQIIIIIIII',data,cursor+72+j*80); sections.append(v)
 cursor+=length
check('UUID',metadata['uuid']=='3FEC147A-7931-3FCD-BDB9-59C9A814779C')
text=[v for v in sections if v[0].rstrip(b'\0')==b'__text' and v[1].rstrip(b'\0')==b'__TEXT'][0]
va,sz,fo=text[2:5]; code=data[fo:fo+sz]
check('text layout',(va,sz,fo)==(0x1000010e8,357072,4328))
starts=[]; acc=metadata['base']; val=shift=0; so,ss=metadata['starts']
for byte in data[so:so+ss]:
 val|=(byte&127)<<shift
 if byte&128: shift+=7; continue
 if val==0: break
 acc+=val; starts.append(acc); val=shift=0
check('wrapper in 1764 function starts',len(starts)==1764 and 0x10000f60c in starts)
symoff,nsyms,stroff,strsize=metadata['symbols']; io,ni=metadata['indirect']; indexes=[]
for i in range(nsyms):
 idx=struct.unpack_from('<I',data,symoff+16*i)[0]
 if data[stroff+idx:stroff+idx+len(b'_coalition_terminate\0')]==b'_coalition_terminate\0': indexes.append(i)
stubs=[]
for v in sections:
 if v[8]&255==8:
  for j in range(v[3]//v[10]):
   idx=struct.unpack_from('<I',data,io+4*(v[9]+j))[0]
   if idx in indexes: stubs.append(v[2]+j*v[10])
check('real importstub distinct',stubs==[0x100058988] and 0x10000f60c not in stubs,[hex(x) for x in stubs])
# Independent instruction decoder (no helper execution).
def sx(n,b): return n-(1<<b) if n>>(b-1) else n
pairs=[]
for i in range(0,len(code),4):
 w=int.from_bytes(code[i:i+4],'little'); pc=va+i; rd=w&31
 if rd==31: continue
 imm=sx(((w>>29)&3)|(((w>>5)&0x7ffff)<<2),21)
 if (w>>24)&0x9f==0x10 and pc+imm==0x10000f60c: pairs.append((pc,None))
 if (w>>24)&0x9f!=0x90 or i+8>len(code): continue
 a=int.from_bytes(code[i+4:i+8],'little')
 if (a>>23)!=0x122 or ((a>>5)&31)!=rd: continue
 immediate=((a>>10)&0xfff)*(4096 if (a>>22)&1 else 1)
 if (pc&~4095)+(imm*4096)+immediate==0x10000f60c: pairs.append((pc,pc+4))
check('independent entire same text exactly 1 candidate',pairs==[(0x10001f27c,0x10001f280)],pairs)
pco=0x10001f27c-va; w,a=struct.unpack_from('<II',code,pco); imm=sx(((w>>29)&3)|(((w>>5)&0x7ffff)<<2),21)
decode={'ADRPword':hex(w),'ADDword':hex(a),'ADRP_rd':w&31,'ADD_rn':(a>>5)&31,'ADD_rd':a&31,'ADRP_signed_pages':imm,'ADRP_page':hex((0x10001f27c&~4095)+4096*imm),'ADD_imm12':(a>>10)&4095,'ADD_shift':(a>>22)&1,'result':hex((0x10001f27c&~4095)+4096*imm+(((a>>10)&4095)<< (12 if (a>>22)&1 else 0)))}
check('ordinary64 ADD x16,x16 correct',w&31==16 and a&31==16 and (a>>5)&31==16 and a>>23==0x122 and (a>>22)&1==0 and decode['result']=='0x10000f60c',decode)
m=js(C/'results/manifest.json'); pre=js(C/'results/preflight.json'); stdout=js(C/'main.stdout')
check('raw main exit/stderr',read(C/'main.exit')==b'0\n' and read(C/'main.stderr')==b'')
workdir=read(C/'main-workdir.txt').decode(); check('main workdir recorded',bool(workdir.strip()),workdir)
check('preflight vs manifest',all(m.get(k)==v for k,v in pre.items()))
check('raw stdout vs manifest',stdout=={k:m[k] for k in ('status','candidateCount','candidates')})
r=m['candidates'][0]; context=raw[750188:750228]
check('candidate/context whole offsets and bytes',off+fo+pco==750204 and r['fileOffset']==750204 and r['contextFileOffset']==750188 and r['contextVA']==0x10001f26c and r['contextBytes']==40 and context.hex()==r['contextHex'])
check('manifest bound identities',m['driverSHA256']==inputs[str(C/'locate_code_address.py')]['sha256'] and m['sourceSHA256']==hashlib.sha256(raw).hexdigest() and m['helperSHA256']==hashlib.sha256(h).hexdigest() and m['sliceSHA256']==hashlib.sha256(data).hexdigest() and m['candidateCount']==1)
preservation=js(C/'prior-preservation.json'); inventory=js(C/'prior-readback/artifact-SHA256.json'); copies=preservation['copies']; total=0
check('22 unique retained inventory entries',len(copies)==22 and len({x['destination'] for x in copies})==22 and len(inventory)==21)
for row in copies:
 p=C/row['destination']; b=read(p); total+=len(b); digest=hashlib.sha256(b).hexdigest(); mode=stat.S_IMODE(p.stat().st_mode)
 check('retained copy '+p.name,len(b)==row['bytes'] and digest==row['sha256'] and mode==0o400 and row['mode']=='0400')
 if p.name!='artifact-SHA256.json': check('inventory seal '+p.name,inventory[p.name]['bytes']==len(b) and inventory[p.name]['sha256']==digest)
check('retained bytes aggregate',total==196430 and preservation['bytes']==total)
for n,expected in [('attempt1-verifier.exit',b'1\n'),('attempt2-verifier.exit',b'1\n'),('verifier.exit',b'0\n')]: check('retained raw '+n,read(C/'prior-readback'/n)==expected)
# Existing checks treated only as retained report data, NOT executed or rehashed earlier copies.
prior=json.loads((C/'prior-readback/checks.json').read_bytes()); check('prior check report retained',len(prior)==224 and all(x['pass'] is True for x in prior))
limits='Read-only repo; own TEMP Python only. No repository/helper compile, import or execution; no old tests rerun; no 92 earlier copies rehashed; no shim/otool/runtime/model/network/control/credentials. CPU15s/wall60s/file4MiB/total16MiB. Static address formation only: not call, reachability, ownership, authority, M3 or parity.'
save('checks.json',checks); save('input-SHA256.json',inputs); save('links.json',links); save('decode.json',decode)
failed=[c for c in checks if not c['pass']]; result={'checks':len(checks),'passed':len(checks)-len(failed),'failed':failed,'elapsedSeconds':time.monotonic()-t0,'limits':limits}; save('summary.json',result)
(OUT/'REPORT.md').write_text('# Independent case16 delivery verification\n\n'+('PASS' if not failed else 'FAIL')+': '+str(result['passed'])+'/'+str(len(checks))+' checks.\n\nFrozen whole/slice/UUID, driver/helper seals, selected AST scope, independent full-text limited address scan, x16 ADRP+ordinary64 ADD decode, 40B context, raw main output and manifests, 22 retained audit files/inventory hashes/sizes/0400 and two original failures/final success checked.\n\n'+json.dumps(decode,indent=2)+'\n\n'+limits+'\n\nSee checks.json, input-SHA256.json, links.json, summary.json, commands.txt and verifier raw streams/exits. Retained 224 checks are prior reported results, not new executions. 92 older copies not read/rehash.\n')
print(json.dumps(result)); raise SystemExit(1 if failed else 0)
