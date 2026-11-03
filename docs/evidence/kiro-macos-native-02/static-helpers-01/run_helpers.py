#!/usr/bin/env python3
"""One-shot bounded key/string helpers, no target launch/attach/model request."""
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import tempfile
import time
ROOT=Path(__file__).resolve().parent
with (ROOT/'.started').open('x') as f:f.write(time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())+'\n')
PREV=json.loads((ROOT.parent/'static-analysis-01'/'verification.json').read_text())
THIN=Path(PREV['thin']['path'])
TARGET=Path('/Applications/Kiro CLI.app/Contents/MacOS/kiro-cli-chat')
FUNCS=[('key',0x100c113d4,0x100c115a4),('string',0x100c10d1c,0x100c10e74)]
WORK=Path(tempfile.mkdtemp(prefix='kiro-mac-request-helpers01-'))
REPORT={'schema':'focused-request-helpers-1','status':'failed_unless_verified','workdir':str(WORK),'commands':[],'checks':{},'functions':{},'boundary':'Two new direct helpers only; offline image analysis, no target execution; does not erase serializer tail gap or prove runtime path'}
SOURCES=[Path(__file__),ROOT.parent/'FocusedMachO.java',ROOT/'EXPERIMENT.md']
def sha(p):
 h=hashlib.sha256()
 with open(p,'rb') as f:
  while True:
   b=f.read(4*1024*1024)
   if not b:break
   h.update(b)
 return h.hexdigest()
def run(argv,timeout,env=None):
 t0=time.monotonic();p=subprocess.Popen(argv,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env,start_new_session=True);hit=False
 try:o,e=p.communicate(timeout=timeout)
 except subprocess.TimeoutExpired:
  hit=True;os.killpg(p.pid,signal.SIGKILL);o,e=p.communicate()
 row={'argv':argv,'exitCode':p.returncode,'timeout':hit,'elapsedSeconds':round(time.monotonic()-t0,3),'stdout':o.decode('utf-8','replace'),'stderr':e.decode('utf-8','replace')};REPORT['commands'].append(row)
 print(json.dumps({k:row[k] for k in ['argv','exitCode','timeout','elapsedSeconds']}),flush=True)
 if hit or p.returncode:raise RuntimeError('command failure '+repr(argv))
 return row['stdout']
REPORT['sourceHashesBefore']={str(p):sha(p) for p in SOURCES}
try:
 REPORT['thin']={'path':str(THIN),'sha256':sha(THIN),'reusedFrom':'static-analysis-01; no repeated extraction/execution'}
 assert REPORT['thin']['sha256']==PREV['thin']['sha256']
 REPORT['targetBeforeSha256']=sha(TARGET);assert REPORT['targetBeforeSha256']==PREV['targetBeforeSha256']
 lldb=['/usr/bin/lldb','--no-lldbinit','--batch','-o','target create --arch arm64 "'+str(THIN)+'"']
 for name,start,stop in FUNCS:lldb+=['-o',f'disassemble --bytes --start-address {hex(start)} --end-address {hex(stop)}']
 lldb+=['-o','quit'];asm=run(lldb,90)
 with (ROOT/'lldb-asm.txt').open('x') as f:f.write(asm)
 parsed={int(a,16):int(w,16).to_bytes(4,'little').hex() for a,w in re.findall(r'\[(0x[0-9a-fA-F]+)\]\s+<\+\d+>:\s+(0x[0-9a-fA-F]{8})\s',asm)}
 env=os.environ.copy();java='/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home';env.update({'JAVA_HOME':java,'PATH':java+'/bin:'+env['PATH'],'GHIDRA_HEADLESS_MAXMEM':'8G','XDG_CONFIG_HOME':str(WORK/'config'),'XDG_CACHE_HOME':str(WORK/'cache'),'GHIDRA_HEADLESS_JAVA_OPTIONS':'-Dapplication.tempdir='+str(WORK/'temp')})
 REPORT['ghidraEnvOverrides']={k:env[k] for k in ['JAVA_HOME','PATH','GHIDRA_HEADLESS_MAXMEM','XDG_CONFIG_HOME','XDG_CACHE_HOME','GHIDRA_HEADLESS_JAVA_OPTIONS']}
 (WORK/'project').mkdir();argv=['/opt/homebrew/opt/ghidra/libexec/support/analyzeHeadless',str(WORK/'project'),'helpers01','-import',str(THIN),'-noanalysis','-max-cpu','4','-scriptPath',str(ROOT.parent)]
 for name,start,stop in FUNCS:argv+=['-postScript','FocusedMachO.java',str(ROOT/(name+'.json')),hex(start),hex(stop-1),'candidate_json_'+name]
 argv+=['-log',str(WORK/'ghidra.log'),'-scriptlog',str(WORK/'script.log'),'-deleteProject'];run(argv,300,env)
 for name,start,stop in FUNCS:
  f=json.loads((ROOT/(name+'.json')).read_text())
  with (ROOT/(name+'.c.txt')).open('x') as fp:fp.write(f.get('c',''))
  with THIN.open('rb') as fp:fp.seek(start-0x100000000);raw=fp.read(stop-start)
  ins=f['instructions'];expected=list(range(start,stop,4));addresses=[int(i['address'],16) for i in ins]
  checks={'decompileCompleted':f['decompileCompleted'],'expectedLanguage':f['language']=='AARCH64:LE:64:AppleSilicon','noGaps':not f['undecodedGaps'],'fullCoverage':f['decodedBytes']==stop-start,'rawBytesMatch':f['bytesHex']==raw.hex(),'addressesMatchFullRangeAndLldb':addresses==expected and [a for a in sorted(parsed) if start<=a<stop]==expected,'instructionWordsMatchLldb':bool(ins) and all(parsed.get(int(i['address'],16))==i['bytes'] for i in ins),'cfgNonempty':len(f['cfg'])>0,'oneFunctionCreatedAtMost':0<=f['functionsAfter']-f['functionsBefore']<=1}
  REPORT['functions'][name]={'start':hex(start),'endExclusive':hex(stop),'bytes':stop-start,'instructions':len(ins),'cfgBlocks':len(f['cfg']),'cfgEdges':sum(len(b['edges']) for b in f['cfg']),'gaps':f['undecodedGaps'],'decompileError':f['decompileError'],'checks':checks}
 REPORT['checks'].update({'twoFunctions':len(REPORT['functions'])==2,'nonemptyAllFunctionChecks':all(len(x['checks'])==9 and all(x['checks'].values()) for x in REPORT['functions'].values()),'officialUnchanged':sha(TARGET)==REPORT['targetBeforeSha256'],'thinUnchanged':sha(THIN)==REPORT['thin']['sha256']})
 REPORT['sourceHashesAfter']={str(p):sha(p) for p in SOURCES};REPORT['checks']['sourcesUnchanged']=REPORT['sourceHashesAfter']==REPORT['sourceHashesBefore']
 REPORT['status']='captured_complete_helper_output' if len(REPORT['checks'])==5 and all(REPORT['checks'].values()) else 'failed_checks'
except Exception as e:REPORT['error']={'type':type(e).__name__,'message':str(e)}
finally:
 REPORT['finishedUtc']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
 with (ROOT/'verification.json').open('x') as f:json.dump(REPORT,f,indent=2);f.write('\n')
 print('STATUS='+REPORT['status'],flush=True)
 print('RECEIPT='+str(ROOT/'verification.json'),flush=True)
raise SystemExit(0 if REPORT['status']=='captured_complete_helper_output' else 1)
