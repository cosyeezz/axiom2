#!/usr/bin/env python3
"""One non-secret settings file, one whitelisted projection; no CLI/auth DB."""
import hashlib,json,os,stat,time
from pathlib import Path
root=Path(__file__).resolve().parent;out=root/'verification.json'
if out.exists():raise SystemExit('CreateNew gate')
t0=time.monotonic();home=Path.home();target=home/'.kiro/settings/cli.json'
r={'schema':'kiro-engine-projection-1','sourceSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'path':str(target),'status':'unresolved','settingKey':'chat.agentEngine','keyPresent':None,'storedEngine':None,'effectiveEngine':None,'userSettingsFileReads':0,'authStorageReads':0,'cliExecutions':0,'userSettingWrites':0,'modelRequests':0}
fd=None
try:
 for index,p in enumerate([home/'.kiro',home/'.kiro/settings',target]):
  s=p.lstat()
  if stat.S_ISLNK(s.st_mode) or (index<2 and not stat.S_ISDIR(s.st_mode)) or (index==2 and not stat.S_ISREG(s.st_mode)):
   r['status']='refused_path_type';break
 else:
  fd=os.open(target,os.O_RDONLY|os.O_NOFOLLOW);s=os.fstat(fd)
  if s.st_size>1048576:r['status']='refused_size'
  else:
   raw=os.read(fd,1048577);r['userSettingsFileReads']=1
   if len(raw)>1048576:r['status']='refused_size'
   else:
    val=json.loads(raw)
    if type(val) is not dict:r['status']='invalid_settings_object'
    elif 'chat.agentEngine' not in val:r['status']='stored_key_absent';r['keyPresent']=False
    else:
     r['keyPresent']=True;engine=val['chat.agentEngine']
     if type(engine) is str and engine in ['v1','v2','v3']:r['storedEngine']=engine;r['status']='projected_stored_engine'
     else:r['status']='stored_value_not_supported_enum'
except FileNotFoundError:r['status']='settings_path_absent'
except OSError as e:r['status']='read_error';r['errno']=e.errno
except (ValueError,UnicodeError):r['status']='invalid_json'
finally:
 if fd is not None:os.close(fd)
r['elapsedSeconds']=round(time.monotonic()-t0,3)
r['boundary']='Only stored single-key non-secret setting; no claim of effective session engine/flags/auto-migration state.'
with out.open('x') as f:json.dump(r,f,indent=2);f.write('\n')
print(json.dumps(r,indent=2));raise SystemExit(0 if r['status'] in ['projected_stored_engine','stored_key_absent','settings_path_absent'] else 1)
