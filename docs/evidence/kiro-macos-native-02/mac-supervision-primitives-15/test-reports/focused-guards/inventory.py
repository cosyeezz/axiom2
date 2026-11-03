import hashlib,json,pathlib,os,resource,signal
resource.setrlimit(resource.RLIMIT_CPU,(15,15));resource.setrlimit(resource.RLIMIT_FSIZE,(4194304,4194304));signal.alarm(60)
d=pathlib.Path('/tmp/new15-independent-guards.87WKS3WO')
files=[]
for p in sorted(d.rglob('*')):
    if p.is_file():
        p.chmod(0o400)
        b=p.read_bytes()
        files.append({'path':str(p.relative_to(d)),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'mode':oct(p.stat().st_mode & 0o777)})
fx=[f for f in files if f['path'].startswith('fixtures/')]
obj={'files':files,'filesExcludingInventory':len(files),'bytesExcludingInventory':sum(f['bytes'] for f in files),'fixtureFiles':len(fx),'uniqueFixtureSHA256':len(set(f['sha256'] for f in fx)),'excludes':['inventory.json']}
b=(json.dumps(obj,indent=2)+'\n').encode()
assert len(b)<=4194304 and sum(f['bytes'] for f in files)+len(b)<=16777216
with (d/'inventory.json').open('xb') as f:f.write(b)
(d/'inventory.json').chmod(0o400)
print(json.dumps({k:v for k,v in obj.items() if k!='files'}))
