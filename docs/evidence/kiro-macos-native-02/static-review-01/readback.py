#!/usr/bin/env python3
"""Verify the new synthesis, hashes, links and frozen counts; no target/test reruns."""
import hashlib
import json
from pathlib import Path
import re
import sys
ROOT=Path(__file__).resolve().parent
OUT=ROOT/'readback.json'
if OUT.exists():raise SystemExit('CreateNew gate')
def strict_pairs(pairs):
 d={}
 for key,value in pairs:
  if key in d:raise ValueError('duplicate JSON key '+key)
  d[key]=value
 return d
def load(p):return json.loads(p.read_text(),object_pairs_hook=strict_pairs)
m=load(ROOT/'verification.json');checks={}
checks['boundedReviewStatus']=m['status']=='supported_static_entry_flow_with_known_gaps' and m['finalParityPassed'] is False
hashes={}
for rel,expected in m['artifactsSha256'].items():
 p=(ROOT/rel).resolve();actual=hashlib.sha256(p.read_bytes()).hexdigest();hashes[rel]={'expected':expected,'actual':actual,'matches':actual==expected}
checks['sixteenArtifactHashes']=len(hashes)==16 and all(v['matches'] for v in hashes.values())
for cap in m['originalCaptures']:
 raw=load(ROOT/cap['path']);checks[cap['path']+' original failure retained']=raw['status']==cap['status']=='failed_checks' and cap['fullGhidraCoveragePassed'] is False
 checks[cap['path']+' child commands']=len(raw['commands'])==2 and all(c['exitCode']==0 and c['timeout'] is False for c in raw['commands'])
 for func in cap['functions']:
  name=func['name'];path=ROOT.parent/('static-analysis-01/focused.json' if name=='serializer' else 'static-helpers-01/'+name+'.json');f=load(path)
  checks[name+' frozen counts']=f['rangeBytes']==func['rangeBytes'] and f['decodedBytes']==func['ghidraDecodedBytes'] and len(f['instructions'])==func['ghidraInstructions'] and len(f['cfg'])==func['cfgBlocks'] and sum(len(b['edges']) for b in f['cfg'])==func['cfgEdges'] and sum(g['bytes'] for g in f['undecodedGaps'])==func['ghidraTailGapBytes']>0
  cpath=path.with_name('decompiled.c.txt' if name=='serializer' else name+'.c.txt');checks[name+' C text matches frozen JSON']=cpath.read_text()==f['c']
links=[]
for doc in [ROOT/'SUMMARY.md',ROOT.parent/'README.md']:
 s=doc.read_text();checks[str(doc.name)+' no trailing whitespace']=all(line==line.rstrip() for line in s.splitlines()) and s.endswith('\n')
 for link in re.findall(r'\[[^\]]+\]\(([^)]+)\)',s):
  if re.match(r'[a-z]+://',link):continue
  rel=link.split('#',1)[0];p=(doc.parent/rel).resolve();links.append({'document':str(doc),'link':link,'exists':p.exists()})
checks['localMarkdownLinks']=len(links)>=20 and all(x['exists'] for x in links)
checks['reportedNoExecutionOrProductionChange']=all(m['countsThisOfficialStaticInvestigation'][x]==0 for x in ['modelRequests','officialTargetExecutions','officialTargetLaunchOrAttach','serializerReruns','applicationSourceChanges','newReviewTargetExecutionsOrDecompilations'])
checks['reviewsConsumed']=len(m['independentReviewReferences'])==3 and all(x['readBack'] is True for x in m['independentReviewReferences'])
report={'schema':'static-synthesis-readback-1','status':'passed_document_integrity_only' if len(checks)>=15 and all(checks.values()) else 'failed_readback','boundary':'Only new synthesis integrity, hashes, local links and frozen-count consistency. Does not rerun original analysis, erase failed gates or establish runtime parity.','command':[sys.executable,str(Path(__file__).resolve())],'sourceSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'checks':checks,'artifacts':hashes,'links':links}
with OUT.open('x') as f:json.dump(report,f,indent=2);f.write('\n')
print(json.dumps({'status':report['status'],'checks':checks,'links':len(links),'artifacts':len(hashes)},indent=2))
raise SystemExit(0 if report['status']=='passed_document_integrity_only' else 1)
