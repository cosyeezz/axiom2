import json,struct,re,hashlib,bisect
from pathlib import Path
D=Path('/tmp/kiro-command-static-iHSt7p');m=json.loads((D/'manifest.json').read_text()); refs=[];cov=[]
f=open(m['source'],'rb')
for name,start,end in [('ws-window',0x10167dc00,0x10167fc00),('stdio-command',0x10168ce28,0x10168dd1c)]:
 b=(D/(name+'.bytes')).read_bytes(); asm=(D/(name+'.asm')).read_text(); pcs=[int(x,16) for x in re.findall(r'\[0x([0-9a-f]+)\]:',asm)]
 cov.append(dict(name=name,start=hex(start),end=hex(end),bytes=len(b),instructions=len(pcs),continuous=pcs==list(range(start,end,4)),sha256=hashlib.sha256(b).hexdigest(),unknown=bool(re.search(r'unknown|\.long|\.inst',asm))))
 for i in range(0,len(b)-4,4):
  w=struct.unpack_from('<I',b,i)[0]
  if w&0x9f000000!=0x90000000:continue
  rd=w&31;imm=((w>>5)&0x7ffff)<<2|((w>>29)&3);imm=imm-(1<<21) if imm&(1<<20) else imm;pc=start+i;page=(pc&~4095)+(imm<<12)
  for j in range(1,min(6,(len(b)-i)//4)):
   a=struct.unpack_from('<I',b,i+j*4)[0]
   if a&0xff000000!=0x91000000 or (a>>5)&31!=rd:continue
   va=page+((a>>10)&4095)*(4096 if a&(1<<22) else 1)
   sec=next((s for s in m['sections'] if s['name'] in ('__const','__cstring') and s['va']<=va<s['va']+s['size']),None)
   if not sec:continue
   assert (len(refs)+1)*64<=16384
   f.seek(m['arm_offset']+sec['offset']+va-sec['va']);v=f.read(64)
   refs.append(dict(pc=hex(pc),add=hex(pc+j*4),va=hex(va),bytes=v.hex(),text=''.join(chr(c) if 32<=c<127 else '.' for c in v)))
(D/'referents.json').write_text(json.dumps(refs,indent=2));(D/'coverage.json').write_text(json.dumps(cov,indent=2))
(D/'referents.log').write_text('\n'.join(str(r) for r in refs)+'\nTOTAL '+str(len(refs)*64)+' bytes\n');print(cov);print('referents',len(refs),len(refs)*64)
