import struct,json,hashlib,bisect
from pathlib import Path
p=Path('/tmp/kiro-cli-static.Bz5akg/binaries/kiro-cli-chat-arm64'); d=p.read_bytes(); base=0x100000000
n=struct.unpack_from('<I',d,16)[0]; off=32; secs=[]; fs=None
for _ in range(n):
 cmd,size=struct.unpack_from('<II',d,off)
 if cmd==0x19:
  ns=struct.unpack_from('<I',d,off+64)[0]
  for i in range(ns):
   s=off+72+i*80; name=d[s:s+16].split(b'\0')[0].decode(); addr,sz,fo=struct.unpack_from('<QQI',d,s+32);secs.append((name,addr,sz,fo))
 if cmd==0x26: fs=struct.unpack_from('<II',d,off+8)
 off+=size
func=[]
if fs:
 v=base;i=fs[0];end=i+fs[1]
 while i<end:
  val=0;sh=0
  while True:
   b=d[i];i+=1;val|=(b&127)<<sh;sh+=7
   if not b&128:break
  if not val:break
  v+=val;func.append(v)
need=[b'GenerateAssistantResponseRequestSerializer',b'AmazonCodeWhispererStreamingService.GenerateAssistantResponse',b'https://runtime.us-east-1.kiro.dev',b'conversationState',b'origin',b'callerContext',b'x-amz-target',b'chat_cli_v2::api_client::endpoints']
targets={}
for s in need:
 st=0
 while True:
  at=d.find(s,st)
  if at<0:break
  if at<0x9000000:targets[base+at]=s.decode()
  st=at+len(s)
x=[]
for name,va,sz,fo in secs:
 if name!='__text':continue
 words=struct.unpack_from('<'+'I'*(sz//4),d,fo)
 for i,w in enumerate(words):
  if w&0x9f000000!=0x90000000:continue
  imm=((w>>29)&3)|(((w>>5)&0x7ffff)<<2)
  if imm&(1<<20):imm-=1<<21
  page=((va+4*i)&~4095)+(imm<<12);rd=w&31
  for j in range(i+1,min(i+6,len(words))):
   z=words[j]
   if z&0xffc00000==0x91000000 and (z>>5)&31==rd:
    dest=page+((z>>10)&4095)
    if dest in targets:
     pc=va+j*4;k=bisect.bisect_right(func,pc)-1
     x.append(dict(string=targets[dest],target=hex(dest),xref=hex(pc),function=hex(func[k]) if k>=0 else None,end=hex(func[k+1]) if k+1<len(func) else None))
res=dict(sha256=hashlib.sha256(d).hexdigest(),sections=secs,strings={hex(k):v for k,v in targets.items()},xrefs=x,method='ARM64 ADRP plus ADD within next 5 instructions; LC_FUNCTION_STARTS. Incomplete heuristic, not REA Evidence.')
Path('/tmp/kiro-client-rea-20261027/cli-rea/bounded-xrefs.json').write_text(json.dumps(res,indent=2));print(json.dumps(x,indent=2))
