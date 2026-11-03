#!/usr/bin/env python3
from pathlib import Path
import hashlib,json,stat,sys
ROOT=Path('/private/tmp/kiro-window-main01.YZHohX')
P=Path(__file__).resolve().parent
FILES=['EXPERIMENT.md','ROOT-TOOL.json','controller.py','harness.cjs','child.cjs','fixture_data.cjs','FIXTURE-SYNTAX-TOOL.json','MANIFEST.json','MANIFEST-TOOL.json','RUN.lock','source-before.json','command.json','node-result.json','undici-result.json','harness-result.json','source-after.json','controller-result.json','TOOL-RESULT.json']
def identity(b):return {'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
def main():
    assert set(x.name for x in ROOT.iterdir())==set(FILES)
    saved={}
    for n in FILES:
        f=ROOT/n;s=f.lstat();assert stat.S_ISREG(s.st_mode) and not f.is_symlink() and s.st_size<=32768;saved[n]=f.read_bytes()
    j=lambda n:json.loads(saved[n]);m=j('MANIFEST.json');r=j('harness-result.json');c=j('controller-result.json');t=j('TOOL-RESULT.json')
    assert t['exit_code']==0 and c['status']=='passed' and c['childExit']==0 and c['timedOut'] is False and c['reportValidated'] is True
    assert c['heldPID']==r['pid'] and len(r['results'])==6 and all(x['passed'] is True for x in r['results'])
    assert [x['id'] for x in r['results']]==['W01-cross-process-ready-order','W02-two-in-one-turn','W03-connection-failure','W04-owner-abort','W05-saved-wrapper-late','W06-close-conflict-last']
    assert r['httpRequests']==r['serverMatches']==2 and len(r['children'])==2
    assert len({r['pid'],*(x['pid'] for x in r['children'])})==3
    for x in r['children']:
        y=j(x['mode']+'-result.json');assert x['exit']==0 and x['signal'] is None and y['ok'] is True and y['pid']==x['pid']
    for n,v in m['fixtureFiles'].items():assert identity(saved[n])==v
    assert j('source-before.json')==j('source-after.json')
    source_binding=(P/'WINDOW-SOURCE-BINDING.json').read_bytes();assert hashlib.sha256(source_binding).hexdigest()==m['sourceBindingSha256']
    source_expected=json.loads(source_binding)['files'];assert j('source-before.json')['files']==source_expected
    sources={}
    for name,v in source_expected.items():
        b=(P/name).read_bytes();assert identity(b)==v;sources[name]=b
    dest=P/'window-main01';dest.mkdir(mode=0o700)
    copies={}
    def put(name,data):
        q=(dest/name).resolve();assert q.is_relative_to(dest.resolve());q.parent.mkdir(parents=True,exist_ok=True)
        with q.open('xb') as f:f.write(data)
        q.chmod(0o400);assert q.read_bytes()==data;copies[name]=identity(data)
    for n,b in saved.items():put(n,b)
    put('tested-WINDOW-SOURCE-BINDING.json',source_binding)
    for n,b in sources.items():put('source-snapshot/request-pair-design-01/'+n,b)
    audit={'status':'verified-and-exclusive-byte-preserved','originalFiles':len(saved),'testedSourceFiles':len(sources),'filesCopied':len(copies),'copies':copies,'sourceHashReadBytesPerPass':j('source-before.json')['hashReadBytes'],'functionalNodes':3,'ownHTTP':2,'cases':6,'toolNumericExit':t['exit_code'],'harnessExit':c['childExit'],'limits':'own fixture only; no official/auth/model; no raw broker-to-server oracle; no owner terminal proof; non-W01 dispose return not saved'}
    with (dest/'AUDIT.json').open('x') as f:json.dump(audit,f,indent=2);f.write('\n')
    print(json.dumps({k:audit[k] for k in ['status','originalFiles','testedSourceFiles','filesCopied','sourceHashReadBytesPerPass','cases','functionalNodes','ownHTTP']}))
try:main()
except Exception:print('{"status":"artifact-verification-failed"}');sys.exit(1)
