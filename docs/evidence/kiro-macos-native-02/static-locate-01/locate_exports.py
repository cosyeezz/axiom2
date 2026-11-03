#!/usr/bin/env python3
"""Focused export-trie follow-up: selected names seen in __LINKEDIT, not nlist."""
import bisect
import hashlib
import json
import mmap
from pathlib import Path
import re
import struct
import time
ROOT=Path(__file__).resolve().parent
OUT=ROOT/'exports.json'
if OUT.exists():raise SystemExit('CreateNew gate')
identity=json.loads((ROOT/'locations.json').read_text())
report={'schema':'macho-export-locate-1','hypothesis':'Selected public Rust names found in LINKEDIT may be dyld export-trie entries even though LC_SYMTAB has no selected names','boundary':'Static export metadata only; no function decoding or execution','matches':[]}
t0=time.monotonic()
with open(identity['target'],'rb') as f,mmap.mmap(f.fileno(),0,access=mmap.ACCESS_READ) as m:
 assert hashlib.sha256(m).hexdigest()==identity['targetSha256']
 base=identity['slice']['offset'];ncmds=struct.unpack_from('<I',m,base+16)[0];p=base+32;exports=None
 for _ in range(ncmds):
  cmd,size=struct.unpack_from('<II',m,p)
  if cmd in (0x22,0x80000022):exports=struct.unpack_from('<II',m,p+40)
  if cmd==0x80000033:exports=struct.unpack_from('<II',m,p+8)
  p+=size
 assert exports and exports[1]>0
 off,size=exports;lo,hi=base+off,base+off+size
 report['targetSha256']=identity['targetSha256'];report['sliceSha256']=identity['slice']['sha256']
 report['exportTrie']={'fileOffsetInSlice':off,'bytes':size,'sha256':hashlib.sha256(m[lo:hi]).hexdigest()}
 def uleb(p,limit):
  value=0;shift=0
  while p<limit:
   b=m[p];p+=1;value|=(b&127)<<shift;shift+=7
   if b<128:return value,p
   if shift>63:raise RuntimeError('invalid ULEB')
  raise RuntimeError('truncated ULEB')
 fs=identity['functionStarts'];p=base+fs['fileOffsetInSlice'];limit=p+fs['bytes'];starts=[];curr=0x100000000
 while p<limit:
  d,p=uleb(p,limit)
  if d==0:break
  curr+=d;starts.append(curr)
 pat=re.compile(rb'GenerateAssistantResponseRequestSerializer|protocol_serde.*(generate_assistant_response|conversation_state)|generate_assistant_response.*serialize|serialize.*generate_assistant_response')
 stack=[(0,b'',0)];nodes=0;terminals=0;matches=0
 while stack:
  rel,name,depth=stack.pop();assert depth<512 and lo+rel<hi
  p=lo+rel;term,p=uleb(p,hi);termend=p+term;assert termend<=hi
  nodes+=1
  if term:
   terminals+=1;flags,p2=uleb(p,termend)
   if pat.search(name):
    matches+=1
    row={'name':name.decode('utf-8','replace'),'flags':flags,'nodeOffsetInTrie':rel}
    if not flags&8:
     value,p2=uleb(p2,termend);address=value if flags&3==2 else 0x100000000+value
     row['address']=hex(address);idx=bisect.bisect_right(starts,address)-1
     if 0<=idx<len(starts)-1:row['functionRangeCandidate']={'start':hex(starts[idx]),'endExclusive':hex(starts[idx+1]),'bytes':starts[idx+1]-starts[idx],'entryMatchesFunctionStart':starts[idx]==address}
    if len(report['matches'])<128:report['matches'].append(row)
  p=termend
  children=m[p];p+=1
  for _ in range(children):
   end=m.find(b'\0',p,hi);assert end>=p
   label=m[p:end];p=end+1;child,p=uleb(p,hi);stack.append((child,name+label,depth+1))
  if nodes>500000 or time.monotonic()-t0>110:raise RuntimeError('trie budget')
 report.update({'nodesVisited':nodes,'terminalCount':terminals,'totalMatches':matches,'retainedLimit':128,'elapsedSeconds':round(time.monotonic()-t0,3)})
with OUT.open('x') as f:json.dump(report,f,indent=2);f.write('\n')
print(json.dumps(report,indent=2))
