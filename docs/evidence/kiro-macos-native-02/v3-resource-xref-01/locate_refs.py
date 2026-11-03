#!/usr/bin/env python3
"""Syntactic ADRP + nearby ADD candidates, not dataflow or runtime xrefs."""
import bisect,hashlib,json,resource,struct,time
from pathlib import Path
ROOT=Path(__file__).resolve().parent;OUT=ROOT/'locations.json'
if OUT.exists():raise SystemExit('CreateNew gate')
resource.setrlimit(resource.RLIMIT_CPU,(60,60));t0=time.monotonic()
metadata=ROOT.parent/'static-locate-01/locations.json';m=json.loads(metadata.read_text());target=Path(m['target']);base=m['slice']['offset'];image=0x100000000
sec=next(s for s in m['sections'] if s['segment']=='__TEXT' and s['name']=='__text');start=int(sec['address'],16);size=sec['bytes'];off=base+sec['fileOffsetInSlice']
anchors={image+v-base:k for k,v in {'serverOverride':312731315,'bundleBytesContext':312731882,'assetPathContext':312732241,'nativeFrame1':312732725,'nativeFrame2':339239487,'serverPathComponent':339239274}.items()};pages={a&~4095 for a in anchors};hits=[];count=0;pageCount=0;h=hashlib.sha256();maxread=0
with target.open('rb') as f:
 fs=m['functionStarts'];f.seek(base+fs['fileOffsetInSlice']);raw=f.read(fs['bytes']);starts=[];address=image;value=shift=0
 for byte in raw:
  value|=(byte&127)<<shift
  if byte&128:shift+=7;continue
  if value==0:break
  address+=value;starts.append(address);value=shift=0
 assert len(starts)==fs['count'] and hashlib.sha256(raw).hexdigest()==fs['sha256']
 for at in range(0,size,4*1024*1024):
  if time.monotonic()-t0>85:raise SystemExit('local deadline; no success report')
  n=min(4*1024*1024,size-at);f.seek(off+at);data=f.read(min(n+32,size-at));maxread=max(maxread,len(data));h.update(data[:n])
  for index,(word,) in enumerate(struct.iter_unpack('<I',data[:n])):
   if word&0x9f000000!=0x90000000:continue
   pc=start+at+index*4;imm=((word>>5)&0x7ffff)*4+((word>>29)&3)
   if imm&(1<<20):imm-=1<<21
   page=(pc&~4095)+(imm<<12)
   if page not in pages:continue
   pageCount+=1;reg=word&31
   for delta in range(1,9):
    p=index*4+delta*4
    if p+4>len(data):break
    w=struct.unpack_from('<I',data,p)[0]
    if w&0xff800000!=0x91000000 or ((w>>5)&31)!=reg:continue
    address=page+(((w>>10)&4095)<<(12 if w&(1<<22) else 0))
    if address not in anchors:continue
    count+=1
    if len(hits)>=40:continue
    fi=bisect.bisect_right(starts,pc)-1
    hits.append({'anchor':anchors[address],'address':hex(address),'adrpPc':hex(pc),'adrpWord':hex(word),'addPc':hex(pc+delta*4),'addWord':hex(w),'baseRegister':reg,'syntacticOnly':True,'functionStart':hex(starts[fi]),'nextFunction':hex(starts[fi+1]),'functionBytes':starts[fi+1]-starts[fi]})
r={'schema':'kas-resource-syntactic-locate-1','status':'located_syntactic_candidates_only','target':str(target),'expectedTargetSha256':m['targetSha256'],'metadataSha256':hashlib.sha256(metadata.read_bytes()).hexdigest(),'sourceSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'textSha256':h.hexdigest(),'codeBytesScanned':size,'functionTableBytes':len(raw),'maxScanReadBytes':maxread,'anchorPagesAdrpCount':pageCount,'exactSyntacticCandidates':count,'candidateCap':40,'candidatesTruncated':count>40,'candidates':hits,'elapsedSeconds':round(time.monotonic()-t0,3),'boundary':'ADRP/ADD syntactic only; no clobber/CFG verification, no indirect/fixup coverage, no execution or actual sender proof.'}
with OUT.open('x') as f:json.dump(r,f,indent=2);f.write('\n')
print(json.dumps(r,indent=2))
