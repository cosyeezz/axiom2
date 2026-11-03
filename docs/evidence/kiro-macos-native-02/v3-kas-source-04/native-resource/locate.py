import mmap,hashlib,struct,json,os,time
p='/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/kiro-mac-identity-rebind01-vni48j5_/kiro-cli-chat.macho'; out='/tmp/kiro-kas-static-new-VWWbOv'; base=215023616
f=open(p,'rb');m=mmap.mmap(f.fileno(),0,access=mmap.ACCESS_READ)
def sha(b):return hashlib.sha256(b).hexdigest()
manifest={'source':p,'size':len(m),'sha256':sha(m),'arm_offset':base,'arm_size':198028304}
magic,ct,cs,ft,ncmd,sz,fl,res=struct.unpack_from('<8I',m,base);off=base+32;secs=[];fs=None
for i in range(ncmd):
 cmd,size=struct.unpack_from('<II',m,off)
 if cmd==0x19:
  seg=struct.unpack_from('<II16sQQQQiiII',m,off)
  for j in range(seg[-2]):
   v=struct.unpack_from('<16s16sQQIIIIIIII',m,off+72+j*80);secs.append({'name':v[0].rstrip(b'\0').decode(),'seg':v[1].rstrip(b'\0').decode(),'va':v[2],'size':v[3],'offset':v[4]})
 if cmd==0x26:fs=struct.unpack_from('<II',m,off+8)
 off+=size
manifest['sections']=secs;manifest['function_starts']=fs
assert manifest['size']==413051920 and manifest['sha256']=='7f684ad558ea35de830086a6d44f3eff4835ce381b70c861f365c8842729b94f'
text=next(s for s in secs if s['name']=='__text'); const=next(s for s in secs if s['offset']==73916416)
manifest['table_sha256']=sha(m[base+197396912:base+197396912+194104]);assert manifest['table_sha256']=='b501bc1a04fe6296a2d418b4c2b7d558d393d1e5954180a6d31c12cb63d5a82e'
anchors=[]
for needle in (b'KIRO_KAS_SERVER_PATH',b'KIRO_KAS_NODE_PATH',b'acp-server.js'):
 start=base+const['offset'];end=start+const['size']
 while True:
  a=m.find(needle,start,end)
  if a<0:break
  anchors.append({'string':needle.decode(),'slice_offset':a-base,'va':const['va']+a-base-const['offset']});start=a+len(needle)
manifest['anchors']=anchors
# decode ULEB function starts relative __TEXT image base
raw=m[base+fs[0]:base+fs[0]+fs[1]];starts=[];v=0;shift=0;pc=0x100000000
for b in raw:
 v|=(b&127)<<shift
 if b&128:shift+=7;continue
 if v==0:break
 pc+=v;starts.append(pc);v=0;shift=0
open(out+'/starts.json','w').write(json.dumps(starts))
# one linear pass ARM64 ADRP + subsequent ADD immediate up to 5 instructions, matching exact anchors
buf=memoryview(m)[base+text['offset']:base+text['offset']+text['size']]; targets={a['va']:a for a in anchors};xrefs=[]
for i in range(0,len(buf)-24,4):
 w=struct.unpack_from('<I',buf,i)[0]
 if w&0x9f000000!=0x90000000:continue
 rd=w&31;imm=((w>>5)&0x7ffff)<<2|((w>>29)&3);imm=imm-(1<<21) if imm&(1<<20) else imm;va=text['va']+i;page=(va&~4095)+(imm<<12)
 if not any((a&~4095)==page for a in targets):continue
 for j in range(1,6):
  a=struct.unpack_from('<I',buf,i+j*4)[0]
  if a&0xff000000==0x91000000 and (a>>5)&31==rd:
   target=page+((a>>10)&4095)*(4096 if a&(1<<22) else 1)
   if target in targets:
    import bisect
    k=bisect.bisect_right(starts,va)-1
    xrefs.append({'adrp':hex(va),'add':hex(va+j*4),'target':targets[target],'start':hex(starts[k]),'end':hex(starts[k+1]),'size':starts[k+1]-starts[k]})
manifest['xrefs']=xrefs
open(out+'/manifest.json','w').write(json.dumps(manifest,indent=2));print(json.dumps(manifest,indent=2))
