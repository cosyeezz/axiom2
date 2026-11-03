import struct,json,hashlib
from pathlib import Path
D=Path('/tmp/kiro-command-static-iHSt7p');a=json.loads((D/'manifest.json').read_text());s=0x10167dc00;e=0x10167fc00
with open(a['source'],'rb') as f:f.seek(a['arm_offset']+s-0x100000000);code=f.read(e-s)
# isolated MH_EXECUTE, one segment, original virtual address
cmdsize=152; hdr=struct.pack('<8I',0xfeedfacf,0x100000c,0,2,1,cmdsize,0,0)
seg=struct.pack('<II16sQQQQiiII',0x19,cmdsize,b'__TEXT',s,e-s,4096,e-s,7,5,1,0)
sec=struct.pack('<16s16sQQIIIIIIII',b'__text',b'__TEXT',s,e-s,4096,2,0,0,0x80000400,0,0,0)
p=D/'ws-window.macho';p.write_bytes((hdr+seg+sec).ljust(4096,b'\0')+code)
(D/'ws-window.bytes').write_bytes(code)
(D/'lldb.commands').write_text(f'target create --arch arm64 "{p}"\ndisassemble --start-address {s:#x} --end-address {e:#x} --bytes\nquit\n')
print('ws-window sha256',hashlib.sha256(code).hexdigest(),'synthetic sha256',hashlib.sha256(p.read_bytes()).hexdigest())
