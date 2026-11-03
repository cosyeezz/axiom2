# Recreate original-VA offline LLDB input from verified converter bytes. No process launch.
import pathlib,struct,sys,json
D=pathlib.Path(sys.argv[1]);m=json.loads((D/'manifest.json').read_text());start=int(m['converter']['start'],16);b=(D/'converter.bin').read_bytes()
h=struct.pack('<8I',0xfeedfacf,0x100000c,0,2,1,152,0,0)
s=struct.pack('<II16sQQQQiiII',0x19,152,b'__TEXT',start,len(b),4096,len(b),5,5,1,0)
c=struct.pack('<16s16sQQIIIIIIII',b'__text',b'__TEXT',start,len(b),4096,2,0,0,0x80000400,0,0,0)
(D/'converter.macho').write_bytes((h+s+c).ljust(4096,b'\0')+b)
