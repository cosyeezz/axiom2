#!/usr/bin/env python3
"""One bounded static literal search. No target execution/config/secret access."""
import hashlib
import json
import mmap
from pathlib import Path
import re
import resource
import time
ROOT=Path(__file__).resolve().parent
OUT=ROOT/'locations.json'
if OUT.exists():raise SystemExit('CreateNew output gate')
resource.setrlimit(resource.RLIMIT_CPU,(120,120))
resource.setrlimit(resource.RLIMIT_AS,(2*1024**3,2*1024**3))
t0=time.monotonic()
old=ROOT.parent/'static-locate-01/locations.json'
binding=json.loads(old.read_text())
p=Path(binding['target']);h=hashlib.sha256()
with p.open('rb') as f:
 for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
assert h.hexdigest()==binding['targetSha256'],'target drift'
assert p.stat().st_size==binding['targetBytes'],'size drift'
sections=[s for s in binding['sections'] if s['segment']=='__TEXT' and s['name'] in ['__cstring','__const']]
assert len(sections)==2
rows=[];stats=[];cap=256
with p.open('rb') as f, mmap.mmap(f.fileno(),0,access=mmap.ACCESS_READ) as m:
 for s in sections:
  base=binding['slice']['offset']+s['fileOffsetInSlice'];end=base+s['bytes'];assert 0<=base<end<=len(m)
  raw=eligible=0
  for hit in re.finditer(b'(?i)v3',m[base:end]):
   raw+=1;pos=base+hit.start();lo=max(base,pos-180);hi=min(end,pos+300)
   # Bound at the closest non-ASCII byte, while retaining printable Rust rodata.
   a=pos
   while a>lo and 32<=m[a-1]<=126:a-=1
   b=pos+2
   while b<hi and 32<=m[b]<=126:b+=1
   if b-a<16:continue
   eligible+=1
   if len(rows)>=cap:continue
   rows.append({'section':s['name'],'fileOffset':pos,'offsetInSlice':pos-binding['slice']['offset'],'address':hex(int(s['address'],16)+pos-base),'contextFileOffset':a,'context':m[a:b].decode('ascii'),'offsetInContext':pos-a})
  stats.append({'section':s['name'],'bytesScanned':s['bytes'],'rawV3Matches':raw,'asciiContextCandidates':eligible})
report={'schema':'kiro-v3-static-locate-1','status':'located_static_candidates_only' if rows else 'no_ascii_candidate_in_selected_sections','boundary':'Static public artifact literals only. No user/client state or runtime reachability proof.','target':str(p),'targetBytes':p.stat().st_size,'targetSha256':h.hexdigest(),'slice':binding['slice'],'metadataSha256':hashlib.sha256(old.read_bytes()).hexdigest(),'sourceSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'sections':stats,'candidateCap':cap,'candidatesTruncated':sum(s['asciiContextCandidates'] for s in stats)>len(rows),'candidates':rows,'elapsedSeconds':round(time.monotonic()-t0,3),'modelRequests':0,'targetExecutions':0,'userConfigurationReads':0,'configurationChanges':0}
with OUT.open('x') as f:json.dump(report,f,indent=2);f.write('\n')
print(json.dumps({'status':report['status'],'sections':stats,'candidatesRetained':len(rows),'truncated':report['candidatesTruncated'],'elapsedSeconds':report['elapsedSeconds']},indent=2))
