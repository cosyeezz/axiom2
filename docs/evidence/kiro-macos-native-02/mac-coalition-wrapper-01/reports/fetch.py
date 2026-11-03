import os, pathlib, subprocess, time, resource, hashlib, json, re, shlex
resource.setrlimit(resource.RLIMIT_CPU,(10,10))
root=pathlib.Path(__file__).resolve().parent
(root/'home').mkdir(); (root/'tmp').mkdir()
env={'HOME':str(root/'home'),'TMPDIR':str(root/'tmp'),'PATH':'/usr/bin:/bin','LC_ALL':'C'}
start=time.monotonic(); records=[]
def save(name,data):
    with (root/name).open('xb') as f: f.write(data)
def fetch(url,label):
    if time.monotonic()-start>=35: raise RuntimeError('total budget prevents another GET')
    hdr=root/(label+'.headers'); err=root/(label+'.stderr'); body=root/(label+'.body')
    # All output paths are inside a CreateNew directory; headers/stderr reserved exclusively.
    with hdr.open('xb'): pass
    cmd=['/usr/bin/curl','-q','--request','GET','--proto','=https','--connect-timeout','5','--max-time','10','--max-filesize','524288','--noproxy','*','--dump-header',str(hdr),'--write-out','%{stderr}\nCURL_HTTP_STATUS=%{http_code}\nCURL_SIZE_DOWNLOAD=%{size_download}\n','--url',url]
    save(label+'.command.txt',('env -i '+ ' '.join(shlex.quote(k+'='+v) for k,v in env.items())+' '+shlex.join(cmd)+'\n').encode())
    capped=False; n=0; t=time.monotonic()
    with err.open('xb') as ef, body.open('xb') as bf:
        p=subprocess.Popen(cmd,env=env,stdout=subprocess.PIPE,stderr=ef)
        while True:
            chunk=p.stdout.read(16384)
            if not chunk: break
            keep=chunk[:max(0,524288-n)]
            bf.write(keep); n+=len(keep)
            if len(keep)!=len(chunk): capped=True; p.kill(); break
        p.stdout.close(); code=p.wait()
    raw=body.read_bytes(); stderr=err.read_text(errors='replace')
    codes=re.findall(r'CURL_HTTP_STATUS=(\d{3})',stderr)
    headercodes=re.findall(rb'^HTTP/[^\s]+\s+(\d{3})',hdr.read_bytes(),re.M)
    status=codes[-1] if codes else (headercodes[-1].decode() if headercodes else None)
    rec={'url':url,'label':label,'curl_exit':code,'http_status':status,'body_bytes':len(raw),'body_sha256':hashlib.sha256(raw).hexdigest(),'cap_exceeded':capped,'elapsed_seconds':time.monotonic()-t,'complete':code==0 and not capped,'command_file':label+'.command.txt','headers_file':label+'.headers','stderr_file':label+'.stderr','body_file':label+'.body'}
    records.append(rec); print(json.dumps(rec),flush=True)
    save('request-%d.json'%len(records),json.dumps(rec,indent=2).encode())
    return rec,raw
r,raw=fetch('https://raw.githubusercontent.com/apple-oss-distributions/xnu/xnu-12377.161.14/bsd/kern/kern_proc.c','01-exact-tag')
if not (r['http_status']=='200' and r['complete']):
    r2,raw2=fetch('https://api.github.com/repos/apple-oss-distributions/xnu/commits/main','02-main-commit')
    if r2['http_status']=='200' and r2['complete']:
        obj=json.loads(raw2); pin=obj.get('sha','')
        if re.fullmatch('[0-9a-fA-F]{40}',pin):
            fetch('https://raw.githubusercontent.com/apple-oss-distributions/xnu/'+pin+'/bsd/kern/kern_proc.c','03-pinned-wrapper')
        else: print('No valid 40hex pin; stopped')
save('manifest.json',json.dumps({'requests':records,'request_count':len(records),'elapsed_seconds':time.monotonic()-start,'budget':{'max_gets':3,'body_cap_each':524288,'connect_seconds':5,'curl_wall_seconds':10,'total_seconds':45,'cpu_seconds':10},'tls':'default verification; no insecure flags','redirects':'not followed','environment':env},indent=2).encode())
print('REPORT_TEMP='+str(root))
