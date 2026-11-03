import re,pathlib
p=pathlib.Path('/tmp/kiro-client-rea-20261027/cli-rea');d=pathlib.Path('/tmp/kiro-cli-static.Bz5akg/binaries/kiro-cli-chat-arm64').read_bytes();regs={};out=[]
for l in (p/'generate-serializer.asm').read_text().splitlines():
 m=re.search(r'adrp\s+(x\d+), (0x[0-9a-f]+)',l)
 if m:regs[m[1]]=int(m[2],16)
 m=re.search(r'add\s+(x\d+), (x\d+), #(\d+)',l)
 if m and m[2] in regs:
  a=regs[m[2]]+int(m[3]);o=a-0x100000000
  if 0<=o<len(d):
   b=d[o:o+140];s=''.join(chr(c) if 32<=c<127 else '.' for c in b)
   l+=f'  // {a:#x} {s}'
 out.append(l)
(p/'generate-serializer.annotated.asm').write_text('\n'.join(out)+'\n')
