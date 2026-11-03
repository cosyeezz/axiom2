import pathlib,sys,json,struct,hashlib,re
D=pathlib.Path(sys.argv[1]); m=json.loads((D/'manifest.json').read_text()); base=m['arm64Offset']; sections=m['sections']; total=0; windows=[]
def sx(n,b):return n-(1<<b) if n>>(b-1) else n
def adrp(pc,w):
 assert w&0x9f000000==0x90000000
 return (pc&~4095)+(sx(((w>>5)&0x7ffff)*4+((w>>29)&3),21)<<12)
def add(w):
 assert w&0xffc00000==0x91000000
 return (w>>10)&4095
def readva(f,va,n,label):
 global total
 sec=next(s for s in sections if s['va']<=va and va+n<=s['va']+s['size'])
 total+=n;assert total<=32768
 f.seek(base+sec['offset']+va-sec['va']); b=f.read(n);assert len(b)==n
 name=label+'.bin';(D/name).write_bytes(b); windows.append({'label':label,'va':hex(va),'bytes':n,'section':sec['segment']+','+sec['name'],'sliceOffset':sec['offset']+va-sec['va'],'sha256':hashlib.sha256(b).hexdigest()})
 return b
with open(m['source'],'rb') as f:
 hh=hashlib.sha256()
 while True:
  b=f.read(4*1024*1024)
  if not b:break
  hh.update(b)
 assert hh.hexdigest()==m['sourceSHA256']
 f.seek(base+m['functionStarts']['offset']); raw=f.read(m['functionStarts']['size']);assert hashlib.sha256(raw).hexdigest()==m['functionStarts']['sha256']
 # independently parse starts against __TEXT base derived from actual load commands
 f.seek(base);h=struct.unpack('<8I',f.read(32));cmds=f.read(h[5]);p=0; text=None
 for _ in range(h[4]):
  cmd,size=struct.unpack_from('<II',cmds,p)
  if cmd==0x19 and cmds[p+8:p+24].rstrip(b'\0')==b'__TEXT':text=struct.unpack_from('<Q',cmds,p+24)[0]
  p+=size
 v=text;acc=shift=0;starts=[]
 for b in raw:
  acc|=(b&127)<<shift
  if b&128:shift+=7;continue
  if not acc:break
  v+=acc;starts.append(v);acc=shift=0
 c=m['converter'];start=int(c['start'],16);end=int(c['end'],16);i=starts.index(start);assert starts[i+1]==end
 lookup=readva(f,0x101a0f800,240,'lookup-verified');w=struct.unpack_from('<I',lookup,28)[0];assert w>>26==0b100101;assert 0x101a0f81c+4*sx(w&0x3ffffff,26)==start
 b=readva(f,start,end-start,'converter-verified');assert b==(D/'converter.bin').read_bytes();assert hashlib.sha256(b).hexdigest()==c['sha256']
 asm=(D/'converter.asm').read_text();matches=re.findall(r'\[0x([0-9a-f]+)\]: 0x([0-9a-f]{8})',asm);assert len(matches)*4==len(b)
 for i,(a,w) in enumerate(matches):assert int(a,16)==start+4*i and int(w,16)==struct.unpack_from('<I',b,i*4)[0]
 words=struct.unpack('<12I',b)
 assert words[2]==0x52190008 and words[3]==0xd37d1d08 and words[6]==0xf8686921 and words[9]==0xf8686920
 lengthbase=adrp(start+16,words[4])+add(words[5]);pointerbase=adrp(start+28,words[7])+add(words[8]);out=[]
 for key in [0x73,0x35]:
  index=(key^0x80)&255;delta=index*8
  length=struct.unpack('<Q',readva(f,lengthbase+delta,8,'key%02x-length'%key))[0]
  ptr=struct.unpack('<Q',readva(f,pointerbase+delta,8,'key%02x-pointer'%key))[0]
  item={'key':hex(key),'index':index,'byteIndex':delta,'lengthEntryVA':hex(lengthbase+delta),'pointerEntryVA':hex(pointerbase+delta),'rawPointer':hex(ptr),'length':length}
  if length<=1024:
   try:
    data=readva(f,ptr,length,'key%02x-string'%key);item['string']=data.decode('utf-8');item['pointer']=hex(ptr)
   except StopIteration:item['unresolved']='raw pointer outside section; no normalization assumed'
  out.append(item)
 result={'lengthBase':hex(lengthbase),'pointerBase':hex(pointerbase),'results':out,'windows':windows,'totalReadWindowBytes':total,'asmEveryWordMatches':True,'functionBoundaryVerified':True}
 (D/'verification.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
