import hashlib,json,mmap,os
from pathlib import Path
D=Path('/tmp/kiro-kas-static-new-VWWbOv');a=json.loads((D/'manifest.json').read_text());r=[]
with open(a['source'],'rb') as f:
 before=os.fstat(f.fileno());m=mmap.mmap(f.fileno(),0,access=mmap.ACCESS_READ)
 full=hashlib.sha256(m).hexdigest();assert full==a['sha256']
 for name,off,size in [('KAS_public_candidate_native_bounded',75706006,0x14fb3a1),('Node_runtime_native_bounded',97707979,0x194743e)]:
  view=memoryview(m)[a['arm_offset']+off:a['arm_offset']+off+size]
  r.append({'name':name,'slice_offset':off,'full_offset':a['arm_offset']+off,'len':size,'end_slice_exclusive':off+size,'sha256':hashlib.sha256(view).hexdigest()});del view
 after=os.fstat(f.fileno());assert (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns)
 result={'same_fd_full_sha256':full,'stat_stable':True,'inode':before.st_ino,'resources':r,'no_decompression':True}
 (D/'resource-hashes.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
