#!/usr/bin/env python3
"""Bounded static metadata, symbol and literal locator; does not execute target."""
import bisect
import hashlib
import json
import mmap
from pathlib import Path
import re
import struct
import time

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'locations.json'
if OUT.exists(): raise SystemExit('CreateNew gate')
TARGET=Path('/Applications/Kiro CLI.app/Contents/MacOS/kiro-cli-chat')
EXPECTED='d238aa4ffd52f127b692edc6e4cdbe9198610c67c8af819e82b81bdd2fe47dd1'
t0=time.monotonic()
report={'schema':'macho-static-locate-1','boundary':'Static Mach-O metadata/literals/symbols only; no instruction decoding or target execution','target':str(TARGET),'commands':[{'argv':['/usr/bin/python3',str(Path(__file__))],'exitCodeOnSuccess':0}]}
with TARGET.open('rb') as f, mmap.mmap(f.fileno(),0,access=mmap.ACCESS_READ) as m:
 sha=hashlib.sha256(m).hexdigest();assert sha==EXPECTED
 report.update({'targetSha256':sha,'targetBytes':len(m)})
 magic,n=struct.unpack_from('>II',m,0);assert magic==0xcafebabe
 entries=[struct.unpack_from('>IIIII',m,8+i*20) for i in range(n)]
 cpu,subtype,base,size,align=next(x for x in entries if x[0]==0x100000c)
 report['slice']={'architecture':'arm64','offset':base,'bytes':size,'sha256':hashlib.sha256(m[base:base+size]).hexdigest()}
 magic,cpu,subtype,kind,ncmds,sizecmds,flags,reserved=struct.unpack_from('<8I',m,base);assert magic==0xfeedfacf
 cmds=[];sections=[];segments=[];symtab=None;funcdata=None;pos=base+32
 for i in range(ncmds):
  cmd,cmdsize=struct.unpack_from('<II',m,pos);assert cmdsize>=8 and pos+cmdsize<=base+size
  cmds.append({'command':hex(cmd),'bytes':cmdsize})
  if cmd==0x19:
   name=m[pos+8:pos+24].split(b'\0')[0].decode();va,vsize,fo,fs=struct.unpack_from('<4Q',m,pos+24)
   nsects=struct.unpack_from('<I',m,pos+64)[0]
   segments.append({'name':name,'vmaddr':hex(va),'vmsize':vsize,'fileoff':fo,'filesize':fs})
   for j in range(nsects):
    p=pos+72+j*80
    sn=m[p:p+16].split(b'\0')[0].decode();sg=m[p+16:p+32].split(b'\0')[0].decode();a,z,o=struct.unpack_from('<QQI',m,p+32)
    sections.append({'segment':sg,'name':sn,'address':hex(a),'bytes':z,'fileOffsetInSlice':o})
  elif cmd==2: symtab=struct.unpack_from('<4I',m,pos+8)
  elif cmd==0x26: funcdata=struct.unpack_from('<2I',m,pos+8)
  elif cmd==0x1b: report['uuid']=m[pos+8:pos+24].hex()
  pos+=cmdsize
 report.update({'segments':segments,'sections':sections,'loadCommands':cmds})
 text=next(s for s in segments if s['name']=='__TEXT');textbase=int(text['vmaddr'],16)
 starts=[]
 if funcdata:
  fo,fs=funcdata;p=base+fo;end=p+fs;curr=textbase
  while p<end:
   delta=0;shift=0
   while True:
    b=m[p];p+=1;delta|=(b&0x7f)<<shift;shift+=7
    if b<128:break
    if shift>63:raise RuntimeError('invalid function start uleb')
   if delta==0:break
   curr+=delta;starts.append(curr)
  report['functionStarts']={'command':'LC_FUNCTION_STARTS','fileOffsetInSlice':fo,'bytes':fs,'sha256':hashlib.sha256(m[base+fo:base+fo+fs]).hexdigest(),'count':len(starts)}
 def location(off):
  rel=off-base
  for s in sections:
   if s['fileOffsetInSlice']<=rel<s['fileOffsetInSlice']+s['bytes'] and s['name']!='__bss':
    return {'vmaddr':hex(int(s['address'],16)+rel-s['fileOffsetInSlice']),'section':s['segment']+','+s['name']}
  return {}
 keys=[b'conversationState',b'profileArn',b'additionalModelRequestFields',b'GenerateAssistantResponse',b'deepseek-3.2']
 literals={}
 for key in keys:
  found=[];count=0;p=base
  while True:
   p=m.find(key,p,base+size)
   if p<0:break
   count+=1
   if len(found)<40:
    left=max(base,p-64);right=min(base+size,p+len(key)+96)
    snippet=''.join(chr(c) if 32<=c<127 else '.' for c in m[left:right])
    found.append({'fileOffset':p,'offsetInSlice':p-base,**location(p),'snippet':snippet})
   p+=1
  literals[key.decode()]={'totalMatches':count,'matches':found,'retainedLimit':40}
 report['literalLocations']=literals
 symbols=[];imports=[];matchcount=0;importcount=0
 pat=re.compile(rb'generate_assistant_response|GenerateAssistantResponse|shape_.*conversation_state|serialize_operation|profile_arn')
 if symtab:
  so,nsyms,stro,strsize=symtab
  report['symbolTable']={'fileOffsetInSlice':so,'count':nsyms,'stringTableBytes':strsize}
  for i in range(nsyms):
   ni,nt,ns,nd,nv=struct.unpack_from('<IBBHQ',m,base+so+i*16)
   if not ni or ni>=strsize:continue
   st=base+stro+ni;en=m.find(b'\0',st,base+stro+strsize);name=m[st:en]
   if pat.search(name):
    matchcount+=1
    if len(symbols)<128:
     idx=bisect.bisect_right(starts,nv)-1
     fun={'start':hex(starts[idx]),'endExclusive':hex(starts[idx+1]) if idx+1<len(starts) else None} if idx>=0 else None
     symbols.append({'name':name[:2400].decode('utf-8','replace'),'address':hex(nv),'type':nt,'sectionIndex':ns,'functionRangeCandidate':fun})
   if nt&0x0e==0 and ns==0 and re.search(rb'^_(connect|send|sendto|write|writev|SSLWrite|Sec.*|posix_spawn.*|exec.*)$',name):
    importcount+=1
    if len(imports)<32:imports.append(name.decode())
   if i%65536==0 and time.monotonic()-t0>115:raise RuntimeError('locator deadline')
 report['symbolCandidates']={'totalMatches':matchcount,'retainedLimit':128,'matches':symbols}
 report['selectedImports']={'totalMatches':importcount,'matches':imports}
 report['unchangedAfterSha256']=hashlib.sha256(m).hexdigest();assert report['unchangedAfterSha256']==sha
report['elapsedSeconds']=round(time.monotonic()-t0,3)
with OUT.open('x') as f:json.dump(report,f,indent=2);f.write('\n')
print('REPORT='+str(OUT))
print('SYMBOL_MATCHES='+str(report['symbolCandidates']['totalMatches']))
print('FUNCTION_STARTS='+str(report.get('functionStarts',{}).get('count')))
for k,v in report['literalLocations'].items():print(k,v['totalMatches'])
print('ELAPSED='+str(report['elapsedSeconds']))
