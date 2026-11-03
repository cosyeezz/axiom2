#!/usr/bin/env python3
"""Read-back verification of new V3 evidence. No repeated scan/target execution."""
import hashlib
import json
from pathlib import Path
import re
ROOT=Path(__file__).resolve().parent;OUT=ROOT/'verification.json'
if OUT.exists():raise SystemExit('CreateNew gate')
def strict(pairs):
 d={}
 for k,v in pairs:
  if k in d:raise ValueError('duplicate key '+k)
  d[k]=v
 return d
def load(p):return json.loads(p.read_text(),object_pairs_hook=strict)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
d=load(ROOT/'locations.json');meta=ROOT.parent/'static-locate-01/locations.json';m=load(meta);target=Path(d['target']);checks={};evidence={}
checks['sourceAndMetadataHashes']=sha(ROOT/'locate_v3.py')==d['sourceSha256'] and sha(meta)==d['metadataSha256']=='fafb323e87828dc687c515169d27de6f1b74e75c4894864775d6b27fdafd7c61'
checks['sameTargetBinding']=d['targetSha256']==m['targetSha256']=='d238aa4ffd52f127b692edc6e4cdbe9198610c67c8af819e82b81bdd2fe47dd1' and d['slice']==m['slice'] and target.stat().st_size==d['targetBytes']==413051984
checks['nonemptyCompleteCandidateProjection']=len(d['candidates'])==236==sum(s['asciiContextCandidates'] for s in d['sections']) and d['candidatesTruncated'] is False and len({c['fileOffset'] for c in d['candidates']})==236
ok=[];windows=[]
with target.open('rb') as f:
 for c in d['candidates']:
  start=c['contextFileOffset'];expected=c['context'].encode('ascii');f.seek(start);actual=f.read(len(expected));pos=c['fileOffset'];s=next(s for s in m['sections'] if s['segment']=='__TEXT' and s['name']==c['section'])
  ok.append(actual==expected and expected[c['offsetInContext']:c['offsetInContext']+2].lower()==b'v3' and start+c['offsetInContext']==pos and int(c['address'],16)==int(s['address'],16)+pos-m['slice']['offset']-s['fileOffsetInSlice'])
 for offset,size,expected in [(0x15944a70,512,'ca501d1ea9594b614071b3d29831f719144aff108c88fbdca7dca72e48292a1b'),(0x10f3a500,512,'5262e44a5e1247dbdaa07ce071fc4246de5d0f92de810c7fd13cbfd97d1f6642'),(0x11537600,640,'556f54efd804b66e66fa1926a70d60b212f0a9a4119bd264fdb468b16ce0193a')]:
  f.seek(offset);data=f.read(size);digest=hashlib.sha256(data).hexdigest();windows.append({'offset':hex(offset),'bytes':len(data),'expectedSha256':expected,'actualSha256':digest,'matches':len(data)==size and digest==expected})
checks['all236ContextBytesAndAddresses']=len(ok)==236 and all(ok)
checks['threeIndependentWindowHashes']=len(windows)==3 and all(x['matches'] for x in windows)
resources={
 '/Applications/Kiro CLI.app/Contents/Resources/manifest.json':'8d497ad22f0de44137fe2f792a1a7c5450492870ad35812a6e6bc627ae1674ad',
 '/Applications/Kiro CLI.app/Contents/Resources/dashboard/assets/index-D74tpJLT.js':'a64f23e90858a70574e0bef62e070f1ecccacbc5f335b5a7f4a4c16716ef952b'}
for path,expected in resources.items():evidence[path]={'expectedSha256':expected,'actualSha256':sha(Path(path))}
checks['publicResourceHashes']=all(x['expectedSha256']==x['actualSha256'] for x in evidence.values())
helpDir=ROOT.parent/'v3-readonly-01';h=load(helpDir/'verification.json')
checks['isolatedHelpRetained']=h['status']=='passed_isolated_help_only' and h['exitCode']==0 and h['stopReason'] is None and h['stdoutBytes']==924 and h['stderrBytes']==0 and h['settingReads']==h['settingWrites']==h['modelRequests']==0 and h['realHomeFileReadsDenied'] is True and h['networkDenied'] is True and h['fileWritesDenied'] is True
checks['helpBytesAndSourceHashes']=sha(helpDir/'settings-help.txt')==h['stdoutSha256'] and sha(helpDir/'read_help.py')==h['sourceSha256']
checks['earlyFailurePreserved']=not (ROOT.parent/'v3-locate-01/locations.json').exists() and (ROOT.parent/'v3-locate-01/FAILURE.md').exists() and (ROOT.parent/'v3-locate-01/locate_v3.py').exists()
checks['notClaimingAddressSpaceHardLimit']=d['osAddressSpaceHardLimitEstablished'] is False and d['maxObservedScanReadBytes']<=66016
links=[];docs=[ROOT/'REVIEW.md',ROOT/'EXPERIMENT.md',ROOT.parent/'README.md',ROOT.parent/'v3-locate-01/FAILURE.md',helpDir/'EXPERIMENT.md']
# verification.json is created below, so this one prospective self-reference is allowed.
for doc in docs:
 s=doc.read_text();checks[str(doc.relative_to(ROOT.parent))+' whitespace']=s.endswith('\n') and all(line==line.rstrip() for line in s.splitlines())
 for link in re.findall(r'\[[^\]]+\]\(([^)]+)\)',s):
  if re.match(r'[a-z]+://',link):continue
  path=(doc.parent/link.split('#',1)[0]).resolve();links.append({'document':str(doc.relative_to(ROOT.parent)),'link':link,'existsOrNewReport':path.exists() or path==OUT.resolve()})
checks['localLinks']=len(links)>=15 and all(x['existsOrNewReport'] for x in links)
report={'schema':'kiro-v3-document-readback-1','status':'passed_static_lookup_and_delivery_only' if len(checks)>=15 and all(checks.values()) else 'failed_readback','nextGate':'waiting_for_actual_client_prompt_and_effective_engine','boundary':'No new complete literal scan, target execution, setting read/write or model request. Static candidates are not current runtime reachability or wire parity.','checks':checks,'independentReferences':[{'taskId':'t10970','resultId':'r10977','readBack':True,'scope':'public resource text scan only'},{'taskId':'t10970','resultId':'r10988','readBack':True,'scope':'seven limited binary windows, 7552B, no full hash rerun'}],'windows':windows,'resources':evidence,'links':links,'documentSha256':{str(p.relative_to(ROOT.parent)):sha(p) for p in docs},'locationsSha256':sha(ROOT/'locations.json'),'verificationSourceSha256':sha(Path(__file__)),'modelRequests':0,'userConfigurationReads':0,'settingWrites':0,'targetHelpExecutionsInThisV3Investigation':1,'targetChatExecutions':0,'effectiveEngine':None,'actualUserPromptConfirmed':False,'finalParityPassed':False}
with OUT.open('x') as f:json.dump(report,f,indent=2);f.write('\n')
print(json.dumps({'status':report['status'],'checks':checks,'links':len(links),'candidateContexts':len(ok),'windowHashes':windows},indent=2))
raise SystemExit(0 if report['status']=='passed_static_lookup_and_delivery_only' else 1)
