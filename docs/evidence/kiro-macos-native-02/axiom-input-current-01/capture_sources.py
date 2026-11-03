from pathlib import Path
import hashlib,json,os,resource,signal,stat,sys,time
P=Path(__file__).resolve().parent
ROOT=Path('/Volumes/D_Work/axiom2')
NAMES=['model-runtime.ts','model-service.ts','agent-worker.ts','model-account-storage.ts','integrations/model-proxy-env.ts','data-root.ts','providers/kiro-chat.ts','providers/kiro.ts','provider-request-observer.ts','agents.ts','agents/runs.ts']
def stamp(s):return [s.st_dev,s.st_ino,s.st_size,s.st_mode,s.st_uid,s.st_mtime_ns,s.st_ctime_ns]
def main():
    with (P/'SOURCE-CAPTURE.lock').open('x') as f:f.write('public-source-post-read-once\n')
    resource.setrlimit(resource.RLIMIT_CPU,(3,4));resource.setrlimit(resource.RLIMIT_CORE,(0,0));signal.alarm(6);started=time.monotonic()
    result={'status':'failed','postReadSnapshot':True,'crossFileAtomic':False,'runtimeLoadingProved':False,'sourceReadBytes':0,'records':[]}
    try:
        for name in NAMES:
            relative='app/src/server/'+name;source=ROOT/relative
            fd=os.open(source,os.O_RDONLY|os.O_NOFOLLOW)
            with os.fdopen(fd,'rb') as f:
                before=stamp(os.fstat(f.fileno()));assert stat.S_ISREG(before[3]) and before[2]<=131072
                b=f.read(131073);after=stamp(os.fstat(f.fileno()));assert before==after and len(b)==before[2]
            result['sourceReadBytes']+=len(b);assert result['sourceReadBytes']<=393216
            b.decode('utf8');digest=hashlib.sha256(b).hexdigest();dest=P/'source-snapshot'/relative
            dest.parent.mkdir(parents=True,exist_ok=True)
            out=os.open(dest,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o400)
            with os.fdopen(out,'wb') as f:f.write(b)
            c=dest.read_bytes();assert c==b and hashlib.sha256(c).hexdigest()==digest
            result['records'].append({'path':relative,'bytes':len(b),'lines':len(b.splitlines()),'sha256':digest,'beforeStamp':before,'afterStamp':after,'copyReadbackEqual':True})
        result['status']='captured-public-source'
    except Exception:result['fault']='public-source-bound-or-copy-fault'
    result['elapsedSeconds']=time.monotonic()-started
    result['driverSha256']=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    data=(json.dumps(result,indent=2)+'\n').encode();assert len(data)<=32768
    with (P/'SOURCE-BINDING.json').open('xb') as f:f.write(data)
    print(json.dumps({'status':result['status'],'files':len(result['records']),'sourceReadBytes':result['sourceReadBytes']}));return 0 if result['status']=='captured-public-source' else 1
if __name__=='__main__':raise SystemExit(main())
