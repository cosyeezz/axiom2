#!/usr/bin/env python3
"""Archive already-selected static public members; no target code execution."""
import gzip,hashlib,io,json,tarfile
from pathlib import Path
R=Path(__file__).resolve().parent
report=json.loads((R/'verification.json').read_text())
assert report['status']=='extracted_public_source_only' and report['frameEof'] and report['targetFileStable']
allowed={'node_modules/@kiro/agent/package.json','node_modules/@kiro/agent/dist/server/acp-server.js','node_modules/@kiro/agent/dist/server/acp-server.externals.json'}
assert {x['path'] for x in report['selectedFiles']}==allowed and len(report['selectedFiles'])==3
src=Path(report['outputDirectory']);archive=R/'selected-public-source.tar.gz';out=R/'archive-verification.json'
assert not archive.exists() and not out.exists()
with archive.open('xb') as f,gzip.GzipFile(filename='',mode='wb',fileobj=f,mtime=0,compresslevel=9) as g,tarfile.open(fileobj=g,mode='w') as t:
 for rec in sorted(report['selectedFiles'],key=lambda x:x['path']):
  path=src/rec['path'];assert path.is_file() and not path.is_symlink();b=path.read_bytes()
  assert len(b)==rec['bytes'] and hashlib.sha256(b).hexdigest()==rec['sha256']
  ti=tarfile.TarInfo(rec['path']);ti.size=len(b);ti.mode=0o400;ti.uid=ti.gid=ti.mtime=0;t.addfile(ti,io.BytesIO(b))
verified=[]
with tarfile.open(archive,mode='r:gz') as t:
 members=t.getmembers();assert len(members)==3 and {m.name for m in members}==allowed
 for m in members:
  assert m.isfile() and m.mode==0o400 and not m.issym() and not m.islnk()
  rec=next(x for x in report['selectedFiles'] if x['path']==m.name)
  with t.extractfile(m) as f:b=f.read(64*1024*1024+1)
  assert len(b)==rec['bytes'] and hashlib.sha256(b).hexdigest()==rec['sha256'];verified.append(rec)
launcher=Path('/Applications/Kiro CLI.app/Contents/MacOS/kiro-cli');h=hashlib.sha256()
with launcher.open('rb') as f:
 for b in iter(lambda:f.read(1048576),b''):h.update(b)
assert h.hexdigest()=='c18e08c40d5aa9d143d605e35e7f8606b6a33316a2fa29c2ac0e4188708e0039'
r={'status':'preserved_public_source_readback_only','sourceSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'archivePath':str(archive),'archiveBytes':archive.stat().st_size,'archiveSha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'membersVerified':verified,'launcherSha256':h.hexdigest(),'launcherBytes':launcher.stat().st_size,'identityBoundary':'On-disk hashes; not atomic loaded-image identity or runtime proof.','targetExecutions':0,'modelRequests':0,'authStorageReads':0,'originalArchiveFrameVerifiedBy':'verification.json'}
archive.chmod(0o400)
with out.open('x') as f:json.dump(r,f,indent=2);f.write('\n')
print(json.dumps({k:v for k,v in r.items() if k!='membersVerified'},indent=2))
