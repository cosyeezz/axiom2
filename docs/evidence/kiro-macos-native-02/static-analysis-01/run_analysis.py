#!/usr/bin/env python3
"""One-shot offline official Mach-O analysis. Never launches or attaches target."""
import hashlib
import json
import mmap
import os
from pathlib import Path
import re
import signal
import subprocess
import tempfile
import time
ROOT=Path(__file__).resolve().parent
with (ROOT/'.started').open('x') as f:f.write(time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())+'\n')
WORK=Path(tempfile.mkdtemp(prefix='kiro-mac-request-static01-'))
TARGET=Path('/Applications/Kiro CLI.app/Contents/MacOS/kiro-cli-chat')
IDENTITY=json.loads((ROOT.parent/'static-locate-01'/'locations.json').read_text())
START,STOP=0x1007d6bb4,0x1007d7ef0
REPORT={'schema':'official-macho-focused-1','status':'failed_unless_verified','workdir':str(WORK),'commands':[],'checks':{},'boundary':'Offline image analysis only. No launch/attach/model requests. One serializer, noanalysis; static reachability not proved.'}
SOURCES=[Path(__file__),ROOT/'FocusedRequest.java',ROOT.parent/'FocusedMachO.java',ROOT/'EXPERIMENT.md']
def sha(p):
 with open(p,'rb') as f:
  h=hashlib.sha256()
  while True:
   b=f.read(4*1024*1024)
   if not b:break
   h.update(b)
  return h.hexdigest()
def run(argv,timeout,env=None):
 t0=time.monotonic();p=subprocess.Popen(argv,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env,start_new_session=True)
 hit=False
 try:out,err=p.communicate(timeout=timeout)
 except subprocess.TimeoutExpired:
  hit=True;os.killpg(p.pid,signal.SIGKILL);out,err=p.communicate()
 row={'argv':argv,'exitCode':p.returncode,'timeout':hit,'elapsedSeconds':round(time.monotonic()-t0,3),'stdout':out.decode('utf-8','replace'),'stderr':err.decode('utf-8','replace')}
 REPORT['commands'].append(row)
 print(json.dumps({k:row[k] for k in ['argv','exitCode','timeout','elapsedSeconds']}),flush=True)
 if hit or p.returncode:raise RuntimeError('command failed: '+repr(argv))
 return row['stdout']
REPORT['sourceHashesBefore']={str(p):sha(p) for p in SOURCES}
try:
 src=(ROOT.parent/'FocusedMachO.java').read_text()
 REPORT['checks']['scriptOnlyClassAndBudgetChanged']=src.replace('FocusedMachO','FocusedRequest').replace('4096','8192')==(ROOT/'FocusedRequest.java').read_text()
 assert REPORT['checks']['scriptOnlyClassAndBudgetChanged']
 REPORT['targetBeforeSha256']=sha(TARGET);assert REPORT['targetBeforeSha256']==IDENTITY['targetSha256']
 thin=WORK/'chat-arm64.macho'
 with TARGET.open('rb') as f:
  f.seek(IDENTITY['slice']['offset']);data=f.read(IDENTITY['slice']['bytes'])
 assert len(data)==IDENTITY['slice']['bytes'] and hashlib.sha256(data).hexdigest()==IDENTITY['slice']['sha256']
 with thin.open('xb') as f:f.write(data)
 del data
 REPORT['thin']={'path':str(thin),'bytes':thin.stat().st_size,'sha256':sha(thin),'executed':False}
 REPORT['functionRange']={'start':hex(START),'endExclusive':hex(STOP),'bytes':STOP-START,'basis':'dyld exported serializer entry and immediately following LC_FUNCTION_STARTS entry'}
 asm=run(['/usr/bin/lldb','--no-lldbinit','--batch','-o','target create --arch arm64 "'+str(thin)+'"','-o',f'disassemble --bytes --start-address {hex(START)} --end-address {hex(STOP)}','-o','quit'],90)
 with (ROOT/'lldb-asm.txt').open('x') as f:f.write(asm)
 env=os.environ.copy();java='/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home'
 env.update({'JAVA_HOME':java,'PATH':java+'/bin:'+env['PATH'],'GHIDRA_HEADLESS_MAXMEM':'8G','XDG_CONFIG_HOME':str(WORK/'config'),'XDG_CACHE_HOME':str(WORK/'cache'),'GHIDRA_HEADLESS_JAVA_OPTIONS':'-Dapplication.tempdir='+str(WORK/'temp')})
 (WORK/'project').mkdir()
 REPORT['ghidraEnvOverrides']={k:env[k] for k in ['JAVA_HOME','PATH','GHIDRA_HEADLESS_MAXMEM','XDG_CONFIG_HOME','XDG_CACHE_HOME','GHIDRA_HEADLESS_JAVA_OPTIONS']}
 run(['/opt/homebrew/opt/ghidra/libexec/support/analyzeHeadless',str(WORK/'project'),'request_static01','-import',str(thin),'-noanalysis','-max-cpu','4','-scriptPath',str(ROOT),'-postScript','FocusedRequest.java',str(ROOT/'focused.json'),hex(START),hex(STOP-1),'candidate_GenerateAssistantResponse_serialize_input','-log',str(WORK/'ghidra.log'),'-scriptlog',str(WORK/'script.log'),'-deleteProject'],300,env)
 focused=json.loads((ROOT/'focused.json').read_text())
 with (ROOT/'decompiled.c.txt').open('x') as f:f.write(focused.get('c',''))
 with thin.open('rb') as f:
  f.seek(START-0x100000000);expected=f.read(STOP-START)
 addrs=[]
 for line in asm.splitlines():
  match=re.search(r'(0x[0-9a-fA-F]+)[^\n]*?:',line)
  if match and START<=int(match.group(1),16)<STOP:addrs.append(int(match.group(1),16))
 ins=focused['instructions']
 REPORT['checks'].update({'decompileCompleted':focused['decompileCompleted'],'expectedLanguage':focused['language']=='AARCH64:LE:64:AppleSilicon','noUndecodedGaps':not focused['undecodedGaps'],'fullByteCoverage':focused['decodedBytes']==STOP-START,'rawBytesMatchSlice':focused['bytesHex']==expected.hex(),'everyInstructionFourBytes':len(ins)>0 and all(len(i['bytes'])==8 for i in ins),'instructionAddressesMatchLldb':addrs==[int(i['address'],16) for i in ins],'cfgNonempty':len(focused['cfg'])>0,'oneFunctionCreatedAtMost':0<=focused['functionsAfter']-focused['functionsBefore']<=1})
 REPORT['lldbInstructionCount']=len(addrs)
 REPORT['focusedSummary']={k:focused[k] for k in ['rangeBytes','decodedBytes','undecodedGaps','functionsBefore','functionsAfter','decompileError']}
 REPORT['focusedSummary'].update({'instructions':len(ins),'cfgBlocks':len(focused['cfg']),'cfgEdges':sum(len(b['edges']) for b in focused['cfg'])})
 REPORT['targetAfterSha256']=sha(TARGET);REPORT['thinAfterSha256']=sha(thin)
 REPORT['sourceHashesAfter']={str(p):sha(p) for p in SOURCES}
 REPORT['checks'].update({'officialUnchanged':REPORT['targetAfterSha256']==REPORT['targetBeforeSha256'],'thinUnchanged':REPORT['thinAfterSha256']==REPORT['thin']['sha256'],'sourcesUnchanged':REPORT['sourceHashesAfter']==REPORT['sourceHashesBefore']})
 REPORT['status']='captured_complete_static_output' if len(REPORT['checks'])>=12 and all(REPORT['checks'].values()) else 'failed_checks'
except Exception as e:REPORT['error']={'type':type(e).__name__,'message':str(e)}
finally:
 REPORT['finishedUtc']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
 with (ROOT/'verification.json').open('x') as f:json.dump(REPORT,f,indent=2);f.write('\n')
 print('STATUS='+REPORT['status'],flush=True)
 print('RECEIPT='+str(ROOT/'verification.json'),flush=True)
raise SystemExit(0 if REPORT['status']=='captured_complete_static_output' else 1)
