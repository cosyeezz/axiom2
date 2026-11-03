#!/usr/bin/env python3
from pathlib import Path
import hashlib,json,os,resource,signal,stat,sys,time
P=Path(__file__).resolve().parent
SOURCE=Path('/private/tmp/kiro-current-kas-member01-k5vna1mo/node_modules/@kiro/agent/dist/server/acp-server.js')
EXPECTED='bf79b2b0fa7ae68653abdf117b4a4dbf064fec6fa7ca49500115f3f2f67581b1'
NEEDLES=[b'MODEL_FALLBACK_REFUSAL',b'MODEL_FALLBACK_AVAILABILITY',b'fallbackChainsCache',b'dpd[',b'session.title.llm',b'fetchFallbackChains(']
def stamp(s):return [s.st_dev,s.st_ino,s.st_size,s.st_mode,s.st_uid,s.st_mtime_ns,s.st_ctime_ns]
def main():
    with (P/'RUN.lock').open('x') as f:f.write('static-public-js-only\n')
    resource.setrlimit(resource.RLIMIT_CPU,(3,4));resource.setrlimit(resource.RLIMIT_CORE,(0,0));signal.alarm(6);start=time.monotonic()
    r={'status':'failed','officialExecutions':0,'jsExecutions':0,'sourceReadBytes':0,'runtimeUseProved':False,'globalCallCompletenessProved':False}
    try:
        fd=os.open(SOURCE,os.O_RDONLY|os.O_NOFOLLOW)
        with os.fdopen(fd,'rb') as f:
            before=stamp(os.fstat(f.fileno()));assert stat.S_ISREG(before[3]) and before[2]==15025207
            b=f.read(15025208);r['sourceReadBytes']=len(b);assert len(b)==15025207 and hashlib.sha256(b).hexdigest()==EXPECTED
            hits={};ranges=[(14778851,14783400)];total=0
            for needle in NEEDLES:
                found=[];pos=0
                while True:
                    at=b.find(needle,pos)
                    if at<0:break
                    found.append(at);assert len(found)<=8;total+=1;assert total<=32;ranges.append((max(0,at-384),min(len(b),at+len(needle)+384)));pos=at+len(needle)
                hits[needle.decode()]=found
            ranges.sort();merged=[]
            for a,z in ranges:
                if merged and a<=merged[-1][1]:merged[-1]=(merged[-1][0],max(z,merged[-1][1]))
                else:merged.append((a,z))
            size=sum(z-a for a,z in merged);assert size<=24576
            after=stamp(os.fstat(f.fileno()));assert before==after
        out=[]
        for a,z in merged:
            fragment=b[a:z].decode('utf8');line=b.count(b'\n',0,a)+1;out.append('=== bytes [%d,%d), line %d ===\n%s\n'%(a,z,line,fragment))
        data='\n'.join(out).encode();assert len(data)<=32768
        with (P/'EXCERPTS.txt').open('xb') as f:f.write(data)
        r.update(status='extracted-static-windows',sourceSha256=EXPECTED,beforeStamp=before,afterStamp=after,hits=hits,windows=merged,selectedBytes=size,outputBytes=len(data),outputSha256=hashlib.sha256(data).hexdigest())
    except Exception:r['fault']='static-bound-or-source-fault'
    r['elapsedSeconds']=time.monotonic()-start
    with (P/'RESULT.json').open('x') as f:json.dump(r,f,indent=2);f.write('\n')
    print(json.dumps({'status':r['status'],'sourceReadBytes':r['sourceReadBytes']}));return 0 if r['status']=='extracted-static-windows' else 1
if __name__=='__main__':raise SystemExit(main())
