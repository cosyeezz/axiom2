import sys
sys.dont_write_bytecode=True
import os,json,hashlib,subprocess,time,resource
from pathlib import Path
resource.setrlimit(resource.RLIMIT_CPU,(30,30))
root=Path(__file__).parent
start=time.monotonic()
source=Path('/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02/observer-http-fixture-02/terminal_consumer.py')
original=Path('/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/axiom-http-independent02-tsxdc8h6/preload')
def sha(b):return hashlib.sha256(b).hexdigest()
before={'source':sha(source.read_bytes())}
for old,new in [('tap.ndjson','snapshot.ndjson'),('tap.ndjson.status.json','snapshot.status.json')]:
    b=(original/old).read_bytes();before[old]=sha(b)
    with (root/new).open('xb') as f:f.write(b)
env={'HOME':str(root/'home'),'TMPDIR':str(root/'tmp'),'PATH':'/usr/bin:/bin','LC_ALL':'C','PYTHONDONTWRITEBYTECODE':'1'}
results=[]
for label,python in [('py39','/usr/bin/python3'),('host314','/Users/dane/.pyenv/versions/3.14.7/bin/python3')]:
    cmd=[python,'-I','-B',str(root/'runner.py'),str(root)]
    with (root/(label+'.stdout.json')).open('xb') as out,(root/(label+'.stderr.log')).open('xb') as err:
        try:
            cp=subprocess.run(cmd,cwd='/Volumes/D_Work/axiom2',env=env,stdin=subprocess.DEVNULL,stdout=out,stderr=err,timeout=min(10,90-(time.monotonic()-start)))
            code=cp.returncode;timedout=False
        except subprocess.TimeoutExpired:
            code=None;timedout=True
    item=dict(label=label,command=cmd,exit_code=code,timed_out=timedout)
    if not timedout:
        try:
            report=json.loads((root/(label+'.stdout.json')).read_bytes())
            item.update(total=report['total'],passed=report['passed'],failed=report['failed'],failures=[r for r in report['cases'] if not r['pass']],cpu_seconds=report['cpu_seconds'])
        except Exception as e:item['report_error']=type(e).__name__+': '+str(e)
    results.append(item)
after={'source':sha(source.read_bytes())}
for old in ['tap.ndjson','tap.ndjson.status.json']:after[old]=sha((original/old).read_bytes())
summary=dict(cwd='/Volumes/D_Work/axiom2',results=results,before=before,after=after,unchanged=before==after,elapsed_seconds=time.monotonic()-start,environment=env,network='none; no OS sandbox; active validation audit blocks open/socket/process/ctypes',fixture_snapshot='copied once from original; both versions execute identical consumer cases; counts not additive')
with (root/'summary.json').open('x') as f:json.dump(summary,f,indent=2)
size=sum(p.stat().st_size for p in root.rglob('*') if p.is_file())
print(json.dumps(dict(summary=summary,total_artifact_bytes=size),indent=2))
assert size<=4194304
assert all((root/(label+suffix)).stat().st_size<=1048576 for label in ['py39','host314'] for suffix in ['.stdout.json','.stderr.log'])
sys.exit(0 if before==after and all(r['exit_code']==0 for r in results) else 1)
