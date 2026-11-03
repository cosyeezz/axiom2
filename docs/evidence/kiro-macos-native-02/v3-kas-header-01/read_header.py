#!/usr/bin/env python3
import hashlib,json
from pathlib import Path
root=Path(__file__).resolve().parent;out=root/'header.json'
if out.exists():raise SystemExit('CreateNew gate')
target=Path('/Applications/Kiro CLI.app/Contents/MacOS/kiro-cli-chat');base=215023616;image=0x100000000
with target.open('rb') as f:
 f.seek(290729622);head=f.read(128);parts=[]
 for address,n in [(0x1048148f8,5),(0x1047b14b4,4),(0x104809cbd,6)]:
  f.seek(base+address-image);b=f.read(n);parts.append({'address':hex(address),'bytes':n,'hex':b.hex(),'ascii':b.decode('ascii') if all(32<=c<127 for c in b) else None})
fmt='unrecognized'
for magic,name in [(b'\x28\xb5\x2f\xfd','zstd'),(b'\x1f\x8b\x08','gzip'),(b'\xfd7zXZ\x00','xz'),(b'PK\x03\x04','zip'),(b'BZh','bzip2')]:
 if head.startswith(magic):fmt=name;break
if fmt=='unrecognized' and head[0]&15==8 and ((head[0]<<8)+head[1])%31==0:fmt='zlib-candidate'
r={'schema':'kas-resource-header-1','sourceSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'target':str(target),'expectedTargetSha256':'d238aa4ffd52f127b692edc6e4cdbe9198610c67c8af819e82b81bdd2fe47dd1','assetFileOffset':290729622,'assetBytesFromAsm':22001675,'headerBytes':len(head),'headerHex':head.hex(),'headerSha256':hashlib.sha256(head).hexdigest(),'format':fmt,'pathComponents':parts,'targetBytesRead':128+sum(p['bytes'] for p in parts),'targetExecutions':0,'modelRequests':0,'boundary':'Header and three static path literals only; no content integrity/effective runtime proof.'}
with out.open('x') as f:json.dump(r,f,indent=2);f.write('\n')
print(json.dumps(r,indent=2))
