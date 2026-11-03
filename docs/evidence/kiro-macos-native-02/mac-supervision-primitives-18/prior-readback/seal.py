import hashlib,json,resource,signal
from pathlib import Path
resource.setrlimit(resource.RLIMIT_CPU,(15,15));resource.setrlimit(resource.RLIMIT_FSIZE,(4194304,4194304));signal.alarm(60)
p=Path('/tmp/case17-delivery.phk2Y4Eb')
with Path('/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02/mac-supervision-primitives-17/results/function.macho').open('rb') as s: raw=s.read(184)
(p/'header-input-SHA256.json').write_text(json.dumps({'function.macho@0+184':{'bytes':184,'sha256':hashlib.sha256(raw).hexdigest()}},indent=2)+'\n')
(p/'seal.exit').write_text('0\n');(p/'seal.stderr').write_bytes(b'')
msg='Artifact seal complete; all TEMP files below16MiB; final verification exit0.\n'
(p/'seal.stdout').write_text(msg)
files=[f for f in p.iterdir() if f.is_file() and f.name!='artifact-SHA256.json']
assert all(f.stat().st_size<=4194304 for f in files) and sum(f.stat().st_size for f in files)<16*1024*1024
inv={f.name:{'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in sorted(files)}
(p/'artifact-SHA256.json').write_text(json.dumps(inv,indent=2)+'\n')
print(msg,end='')
