import json,struct,hashlib,bisect,mmap
from pathlib import Path
D=Path('/tmp/kiro-env-static-HV1Fnl');P=Path('/tmp/kiro-command-static-iHSt7p');old=json.loads((P/'manifest.json').read_text());starts=json.loads((P/'starts.json').read_text());f=open(old['source'],'rb');m=mmap.mmap(f.fileno(),0,access=mmap.ACCESS_READ)
assert len(m)==413051920 and hashlib.sha256(m).hexdigest()==old['sha256']=='7f684ad558ea35de830086a6d44f3eff4835ce381b70c861f365c8842729b94f'
base=old['arm_offset'];assert hashlib.sha256(m[base+197396912:base+197396912+194104]).hexdigest()==old['table_sha256']
# Independently decode current source function table, no __text scan.
raw=m[base+197396912:base+197396912+194104];fresh=[];v=shift=0;pc=0x100000000
for b in raw:
 v|=(b&127)<<shift
 if b&128:shift+=7;continue
 if not v:break
 pc+=v;fresh.append(pc);v=shift=0
assert fresh==starts
b=(P/'stdio-command.bytes').read_bytes();assert hashlib.sha256(b).hexdigest()=='eaa653e182f5d56e3816f0661389173d595b5bc25f942f7f2decb58741ca15e4'
helpers=[]
for name,pc,cap in [('new-like',0x10168d744,16384),('env-insert-like',0x10168da14,8192)]:
 w=struct.unpack_from('<I',b,pc-0x10168ce28)[0];assert w&0xfc000000==0x94000000
 imm=w&0x3ffffff;imm=imm-(1<<26) if imm&(1<<25) else imm;target=pc+4*imm;k=bisect.bisect_right(fresh,target)-1;s,e=fresh[k:k+2];assert s==target
 h=dict(name=name,call=hex(pc),word=hex(w),target=hex(target),start=hex(s),end=hex(e),size=e-s,cap=cap,within_cap=e-s<=cap);helpers.append(h)
 if e-s>cap:continue
 code=m[base+s-0x100000000:base+e-0x100000000];(D/(name+'.bytes')).write_bytes(code)
 hdr=struct.pack('<8I',0xfeedfacf,0x100000c,0,2,1,152,0,0);seg=struct.pack('<II16sQQQQiiII',0x19,152,b'__TEXT',s,e-s,4096,e-s,7,5,1,0);sec=struct.pack('<16s16sQQIIIIIIII',b'__text',b'__TEXT',s,e-s,4096,2,0,0,0x80000400,0,0,0)
 (D/(name+'.macho')).write_bytes((hdr+seg+sec).ljust(4096,b'\0')+code)
 (D/(name+'.commands')).write_text(f'target create --arch arm64 "{D/(name+".macho")} "\ndisassemble --start-address {s:#x} --end-address {e:#x} --bytes\nquit\n'.replace('.macho \"','.macho\"'))
# Save load commands for bounded symbol binding later, not dump symbol/string tables.
off=base+32;ncmd=struct.unpack_from('<I',m,base+16)[0];lc=[]
for i in range(ncmd):
 cmd,size=struct.unpack_from('<II',m,off)
 if cmd in (2,0xb,0x80000022,0x80000033):lc.append(dict(cmd=hex(cmd),words=struct.unpack_from('<'+'I'*(size//4),m,off)))
 off+=size
out=dict(source=old['source'],sha256=old['sha256'],size=len(m),arm_offset=base,table_sha256=old['table_sha256'],helpers=helpers,load_commands=lc)
(D/'manifest.json').write_text(json.dumps(out,indent=2));print(json.dumps(out,indent=2))
