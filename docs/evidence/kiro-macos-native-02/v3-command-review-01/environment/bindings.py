import json,struct,mmap,re,hashlib
from pathlib import Path
D=Path('/tmp/kiro-env-static-HV1Fnl');a=json.loads((D/'manifest.json').read_text());f=open(a['source'],'rb');m=mmap.mmap(f.fileno(),0,access=mmap.ACCESS_READ);base=a['arm_offset'];want=set();coverage=[]
for h in a['helpers']:
 s=int(h['start'],16);b=(D/(h['name']+'.bytes')).read_bytes();asm=(D/(h['name']+'.asm')).read_text();pcs=[int(v,16) for v in re.findall(r'\[0x([0-9a-f]+)\]:',asm)]
 coverage.append(dict(name=h['name'],bytes=len(b),instructions=len(pcs),continuous=pcs==list(range(s,int(h['end'],16),4)),unknown=bool(re.search(r'unknown|\.long|\.inst',asm)),sha256=hashlib.sha256(b).hexdigest()));want.add(s)
 for i in range(0,len(b),4):
  w=struct.unpack_from('<I',b,i)[0]
  if w&0x7c000000==0x14000000:
   v=w&0x3ffffff;v=v-(1<<26) if v&(1<<25) else v;want.add(s+i+4*v)
# Function starts + unexpanded direct external helper address set only; no code read.
syms=[]
lc=next(v['words'] for v in a['load_commands'] if v['cmd']=='0x2');_,_,so,n,st,sz=lc
for i in range(n):
 x,ty,se,de,va=struct.unpack_from('<IBBHQ',m,base+so+i*16)
 if va in want:
  end=m.find(b'\0',base+st+x,base+st+sz);syms.append(dict(kind='nlist',va=hex(va),name=m[base+st+x:end].decode(errors='replace')))
# Resolve symbol stub entries through current indirect table to current nlist names.
lc=next(v['words'] for v in a['load_commands'] if v['cmd']=='0xb');indoff=lc[14];nind=lc[15];off=base+32;ncmd=struct.unpack_from('<I',m,base+16)[0]
for _ in range(ncmd):
 cmd,size=struct.unpack_from('<II',m,off)
 if cmd==0x19:
  ns=struct.unpack_from('<I',m,off+64)[0]
  for j in range(ns):
   v=struct.unpack_from('<16s16sQQIIIIIIII',m,off+72+j*80);name,seg,va,l,fo,al,relo,nrel,flags,r1,r2,r3=v
   if flags&255!=8 or not r2:continue
   for target in want:
    if va<=target<va+l and (target-va)%r2==0:
     ix=r1+(target-va)//r2;idx=struct.unpack_from('<I',m,base+indoff+ix*4)[0]
     if idx>=n:continue
     stx=struct.unpack_from('<I',m,base+so+idx*16)[0];end=m.find(b'\0',base+st+stx,base+st+sz);syms.append(dict(kind='symbol-stub',va=hex(target),name=m[base+st+stx:end].decode(errors='replace')))
 off+=size
# Current image export trie; walk metadata only, collect exact target bindings.
lc=next(v['words'] for v in a['load_commands'] if v['cmd']=='0x80000022');eo,es=lc[-2:];tr=m[base+eo:base+eo+es]
def u(p):
 v=sh=0
 while True:
  b=tr[p];p+=1;v|=(b&127)<<sh
  if b<128:return v,p
  sh+=7
stack=[(0,'')];nodes=0
while stack:
 p,name=stack.pop();nodes+=1;t,q=u(p);end=q+t
 if t:
  flags,z=u(q)
  if not flags&8:
   addr,z=u(z);va=addr if flags&3==2 else 0x100000000+addr
   if va in want:syms.append(dict(kind='export-trie',va=hex(va),name=name,flags=flags))
 p=end;count=tr[p];p+=1
 for j in range(count):
  e=tr.index(0,p);edge=tr[p:e].decode(errors='replace');child,p=u(e+1);stack.append((child,name+edge))
(D/'bindings.json').write_text(json.dumps(dict(targets=sorted(hex(v) for v in want),bindings=syms,export_nodes=nodes),indent=2));(D/'coverage.json').write_text(json.dumps(coverage,indent=2));print(json.dumps(syms,indent=2));print('export nodes',nodes)
# Single 32B literal load referent; no large referent table.
va=0x102d61754;b=(D/'new-like.bytes').read_bytes();w=struct.unpack_from('<I',b,va-0x102d61610)[0];imm=((w>>5)&0x7ffff)<<2|((w>>29)&3);imm=imm-(1<<21) if imm&(1<<20) else imm;target=(va&~4095)+(imm<<12)+0x1a9
ref=m[base+target-0x100000000:base+target-0x100000000+32];(D/'referents.json').write_text(json.dumps(dict(pc=hex(va),va=hex(target),size=32,bytes=ref.hex(),text=ref.decode(errors='replace')),indent=2));print('referent',hex(target),ref)
