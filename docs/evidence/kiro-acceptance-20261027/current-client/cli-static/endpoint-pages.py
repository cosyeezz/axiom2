import json,struct,bisect
from pathlib import Path
D=Path('/tmp/kiro-cli-static.Bz5akg/binaries/kiro-cli-chat-arm64').read_bytes();j=json.loads(Path('/tmp/kiro-client-rea-20261027/cli-rea/bounded-xrefs.json').read_text());out=[]
for name,va,sz,fo in j['sections']:
 if name!='__text':continue
 W=struct.unpack_from('<'+'I'*(sz//4),D,fo)
 for i,w in enumerate(W):
  if w&0x9f000000!=0x90000000:continue
  imm=((w>>29)&3)|(((w>>5)&0x7ffff)<<2)
  if imm&(1<<20):imm-=1<<21
  page=((va+4*i)&~4095)+(imm<<12)
  if page in [0x108ae8000,0x10b71a000]:out.append(hex(va+i*4))
Path('/tmp/kiro-client-rea-20261027/cli-rea/endpoint-page-xrefs.json').write_text(json.dumps(out,indent=2));print(out)
