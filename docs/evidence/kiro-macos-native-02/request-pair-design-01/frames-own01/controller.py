import os,subprocess,time,json,hashlib
p=os.path.dirname(os.path.abspath(__file__))
node='/Users/dane/.local/share/pi-node/node-v22.23.2-darwin-arm64/bin/node'
start=time.monotonic(); child=subprocess.Popen([node,p+'/harness.cjs'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,cwd=p,env={'PATH':'/usr/bin:/bin','HOME':p,'TMPDIR':p})
pid=child.pid; timed=False
try: code=child.wait(timeout=6)
except subprocess.TimeoutExpired:
 timed=True;child.kill();code=child.wait()
base='/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02/request-pair-design-01'
post={}
for n in ['candidate_frames.cjs','RAM-IPC-CONTRACT.md','FRAME-SOURCE-BINDING.json','traffic_values.cjs']:
 b=open(base+'/'+n,'rb').read();post[n]={'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
r=json.load(open(p+'/result.json')) if os.path.exists(p+'/result.json') else None
report={'heldPID':pid,'waitExit':code,'timedOut':timed,'elapsedSeconds':time.monotonic()-start,'nodeLaunchCount':1,'pipeEOFEvidence':False,'sourceAfter':post,'resultPIDMatches':r is not None and r['pid']==pid,'caseIDsMatch':r is not None and [x['id'] for x in r['results']]==json.load(open(p+'/manifest.json'))['caseIDs'],'actualToolNumeric':'unknown'}
with open(p+'/controller-result.json','x') as f:json.dump(report,f,indent=2)
raise SystemExit(code if code>=0 else 128-code)
