import struct,json,hashlib
from pathlib import Path
D=Path('/tmp/kiro-kas-static-new-VWWbOv');a=json.loads((D/'manifest.json').read_text());b=(D/'resolver.bytes').read_bytes();s=0x101631f3c; refs=[]
with open(a['source'],'rb') as f:
 for i in range(0,len(b)-8,4):
  w,z=struct.unpack_from('<II',b,i)
  if w&0x9f000000!=0x90000000 or z&0xff000000!=0x91000000 or (w&31)!=((z>>5)&31):continue
  imm=((w>>5)&0x7ffff)*4+((w>>29)&3);imm=imm-(1<<21) if imm&(1<<20) else imm
  va=((s+i)&~4095)+(imm<<12)+((z>>10)&4095)*(4096 if z&(1<<22) else 1)
  sec=next((x for x in a['sections'] if x['offset'] and x['va']<=va<x['va']+x['size']),None)
  if not sec:continue
  off=sec['offset']+va-sec['va'];f.seek(a['arm_offset']+off);data=f.read(64)
  refs.append({'pc':hex(s+i),'va':hex(va),'slice_offset':off,'bytes':data.hex(),'ascii':''.join(chr(c) if 32<=c<127 else '.' for c in data),'sha256':hashlib.sha256(data).hexdigest()})
(D/'referents.json').write_text(json.dumps(refs,indent=2));print('window_bytes',len(refs)*64)
for r in refs:
 if r['pc'] in ['0x1016324cc','0x1016324dc','0x101632fe8'] or 0x101634884<=int(r['pc'],16)<=0x10163492c:print(r)
