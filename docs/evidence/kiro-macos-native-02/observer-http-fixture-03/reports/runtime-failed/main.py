import os,sys,json,time,hashlib,subprocess,selectors,signal,resource,importlib.util,pathlib
sys.dont_write_bytecode=True
ROOT=pathlib.Path(__file__).parent
SRC=pathlib.Path('/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02/observer-http-fixture-02')
NODE='/Users/dane/.local/share/pi-node/node-v22.23.2-darwin-arm64/bin/node'
TAP=SRC/'fake-http-tap.cjs'; CON=SRC/'terminal_consumer.py'
EXPECTED=['f21dbb781ae4d106763ef327defd0c47f7100cc358a1343fd30d6997de2fc77a','0a4871784b92e07baa43f9ad2395e95d6ac0b5250ec390e548f05a9b61193bdf']
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,data):
 with open(p,'x') as f:f.write(data)
before=[sha(TAP),sha(CON)]; assert before==EXPECTED,before
resource.setrlimit(resource.RLIMIT_CPU,(30,30))
signal.signal(signal.SIGALRM,lambda a,b:(_ for _ in ()).throw(TimeoutError('total90s')));signal.alarm(90)
spec=importlib.util.spec_from_file_location('strictconsumer02',CON); consumer=importlib.util.module_from_spec(spec);spec.loader.exec_module(consumer)
write(ROOT/'client.cjs',r"""'use strict';
const fs=require('node:fs'),http=require('node:http'),crypto=require('node:crypto');
const mode=process.argv[2],tap=require(process.env.TAP_PATH);
const N=mode==='bodycap'?3:mode==='eventcap'?34:mode==='logcap'?20:1;
const body=mode==='bodycap'?Buffer.alloc(96*1024,0x4b):Buffer.from('');
const expected=crypto.createHash('sha256').update(body).digest('hex');
let received=0,callbacks=0,responses=0,returns=0,bytes=0,errors=[];const snapshots=[];
const server=http.createServer({maxHeaderSize:128*1024},(req,res)=>{
 const hash=crypto.createHash('sha256');let n=0;req.on('data',b=>{hash.update(b);n+=b.length});
 req.on('end',()=>{if(n!==body.length||hash.digest('hex')!==expected)errors.push('literal-body-mismatch');received++;bytes+=n;res.end('owned-ok');});
});
server.listen(0,'127.0.0.1',async()=>{try{
 for(let i=0;i<N;i++)await new Promise((resolve,reject)=>{
 const req=http.request({host:'127.0.0.1',port:server.address().port,path:'/owned',method:body.length?'POST':'GET',headers:mode==='logcap'?{'x-owned':'L'.repeat(60000)}:{},agent:false},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>{if(text!=='owned-ok')errors.push('response');responses++;resolve()});});
 req.on('error',reject);if(req.end(body,()=>{callbacks++})===req)returns++;
 });
 // final snapshot plus post-failure requests prove first failure remains sticky.
 snapshots.push(tap.automaticStatus());
 server.close(()=>{console.log(JSON.stringify({mode,N,received,callbacks,responses,returns,bytes,expectedBodySHA:expected,errors,snapshots}));});
 }catch(e){console.error(e.stack);server.close();process.exitCode=2;}});
""")
write(ROOT/'writer-fault.cjs',r"""'use strict';
const fs=require('node:fs');const open=fs.openSync,write=fs.writeSync;let target=null,hits=0;
fs.openSync=function(...args){const fd=Reflect.apply(open,this,args);if(args[0]===process.env.AXIOM_FAKE_TRACE&&args[1]==='wx'){target=fd;fs.writeFileSync(process.env.FAULT_RECORD,JSON.stringify({targetFD:fd,openFlags:args[1],trace:args[0]}),{flag:'wx'});}return fd;};
fs.writeSync=function(fd,...rest){if(fd===target){hits++;fs.writeFileSync(process.env.FAULT_HITS,JSON.stringify({targetFD:target,hits}));throw new Error('test-only exact trace FD write failure');}return Reflect.apply(write,this,[fd,...rest]);};
""")
write(ROOT/'hang.cjs',r"""'use strict';
const fs=require('node:fs');const p=process.env.TMPDIR;
process.on('SIGTERM',()=>{});
if(process.argv[2]==='earlylate'){
 const ev=[{kind:'request',id:1,method:'GET',path:'/owned'},{kind:'request-call',api:'http.request',originalReturned:true,id:1},{kind:'header-cache',id:1,value:'GET /owned HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n'},{kind:'end',id:1,originalReturned:true,returnType:'object',returnIsThis:true,booleanReturn:null,bytes:0,bodyBase64:''}];
 const raw=ev.map(x=>JSON.stringify(x)+'\n').join('');const status=JSON.stringify({ok:true,reason:null,events:4,bodyBytes:0,logBytes:Buffer.byteLength(raw),requests:1,pendingBodyBytes:0});
 fs.writeFileSync(p+'/early.trace',raw,{flag:'wx'});fs.writeFileSync(p+'/early.status',status,{flag:'wx'});
 setTimeout(()=>{fs.writeFileSync(p+'/late.trace',raw,{flag:'wx'});fs.writeFileSync(p+'/late.status',status,{flag:'wx'});},350);
}
setInterval(()=>{},1000);
""")
def child_limits():resource.setrlimit(resource.RLIMIT_CPU,(10,10))
def run(name,args,env,deadline=10,grace=0):
 start=time.monotonic();p=subprocess.Popen(args,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env,cwd=env['TMPDIR'],preexec_fn=child_limits)
 sel=selectors.DefaultSelector();buf={'stdout':bytearray(),'stderr':bytearray()};eof={k:False for k in buf};sticky=[];killed=False
 for stream,key in [(p.stdout,'stdout'),(p.stderr,'stderr')]:os.set_blocking(stream.fileno(),False);sel.register(stream,selectors.EVENT_READ,key)
 while sel.get_map() or p.poll() is None:
  elapsed=time.monotonic()-start
  if elapsed>deadline and not sticky:sticky.append('parent-deadline');p.terminate()
  if sticky and elapsed>deadline+grace and p.poll() is None and not killed:p.kill();killed=True
  for key,_ in sel.select(.015):
   data=os.read(key.fileobj.fileno(),65536)
   if not data:eof[key.data]=True;sel.unregister(key.fileobj);key.fileobj.close()
   elif len(buf[key.data])+len(data)>1024*1024:
    if 'output-cap' not in sticky:sticky.append('output-cap')
    p.kill();killed=True
   else:buf[key.data].extend(data)
 rc=p.wait();sel.close()
 if rc!=0:sticky.append('nonzero-exit')
 if not all(eof.values()):sticky.append('missing-EOF')
 for key,data in buf.items():(ROOT/name/(key+'.log')).write_bytes(data)
 return {'pid':p.pid,'command':args,'exit':rc,'EOF':eof,'elapsed':round(time.monotonic()-start,3),'ownerReasons':sticky,'killed':killed,'stdoutBytes':len(buf['stdout']),'stderrBytes':len(buf['stderr'])},bytes(buf['stdout'])
def env_for(d):
 (d/'home').mkdir();return {'HOME':str(d/'home'),'TMPDIR':str(d),'PATH':str(pathlib.Path(NODE).parent),'LANG':'C','AXIOM_FAKE_ONLY':consumer.SCOPE,'AXIOM_FAKE_TRACE':str(d/'trace.ndjson'),'TAP_PATH':str(TAP)}
results=[]
for case in ['missingguard','existingtrace','writerfault','bodycap','eventcap','logcap','childhang','earlylate']:
 d=ROOT/case;d.mkdir();env=env_for(d)
 args=[NODE,'--require',str(TAP),str(ROOT/'client.cjs'),case]
 if case=='missingguard':del env['AXIOM_FAKE_ONLY']
 if case=='existingtrace':write(d/'trace.ndjson','owned sentinel\n')
 if case=='writerfault':
  env.update(FAULT_RECORD=str(d/'fault-record.json'),FAULT_HITS=str(d/'fault-hits.json'));args=[NODE,'--require',str(ROOT/'writer-fault.cjs'),'--require',str(TAP),str(ROOT/'client.cjs'),case]
 if case in ['childhang','earlylate']:args=[NODE,str(ROOT/'hang.cjs'),case]
 r,out=run(case,args,env,deadline=.22 if case in ['childhang','earlylate'] else 10,grace=.35 if case=='earlylate' else 0)
 r['case']=case;r['terminalPresent']=(d/'trace.ndjson.status.json').exists()
 checks=[]
 if case in ['missingguard','existingtrace']:
  checks+=[r['exit']!=0,not r['terminalPresent'],all(r['EOF'].values())]
  if case=='existingtrace':checks.append((d/'trace.ndjson').read_bytes()==b'owned sentinel\n')
  r['consumer']='not invoked: lifecycle/startup rejection'
 elif case in ['childhang','earlylate']:
  checks+=[r['exit']==-signal.SIGKILL,r['killed'],all(r['EOF'].values()),'parent-deadline' in r['ownerReasons']]
  r['consumer']='not invoked for owned acceptance: deadline permanently failed'
  if case=='earlylate':
   # Artifact-only probe after reap does NOT clear the owner's earlier failure.
   probes={}
   for when in ['early','late']:
    v=consumer.validate_capture((d/(when+'.status')).read_bytes(),(d/(when+'.trace')).read_bytes(),scope=consumer.SCOPE,expected_requests=1);probes[when]='artifact-valid synthetic harness input'
   r['artifactOnlyProbes']=probes;r['ownerAcceptAfterLate']=not r['ownerReasons'];checks.append(not r['ownerAcceptAfterLate'])
 else:
  payload=json.loads(out);r['API']=payload;status=json.loads((d/'trace.ndjson.status.json').read_bytes());r['terminal']=status
  n=payload['N'];checks += [r['exit']==0,all(r['EOF'].values()),not payload['errors'],all(payload[k]==n for k in ['received','callbacks','responses','returns']),status['ok'] is False,status['pendingBodyBytes']==0,status['events']<=128,status['bodyBytes']<=262144,status['logBytes']<=1048576]
  reason={'writerfault':'observer-sink-failed','bodycap':'body-cap','eventcap':'event-or-log-cap','logcap':'event-or-log-cap'}[case];checks.append(status['reason']==reason)
  checks.append(payload['snapshots'][-1]==status)
  if case=='eventcap':checks.append(status['events']==128)
  if case=='logcap':checks.append(status['events']<128)
  try:consumer.validate_capture((d/'trace.ndjson.status.json').read_bytes(),(d/'trace.ndjson').read_bytes(),scope=consumer.SCOPE,expected_requests=n);r['consumer']='UNEXPECTED ACCEPT';checks.append(False)
  except ValueError as e:r['consumer']='rejected: '+str(e);checks.append(str(e)=='observer failure')
 r['checks']=checks;r['pass']=all(checks);results.append(r)
 (ROOT/'progress.json').write_text(json.dumps(results,indent=2))
after=[sha(TAP),sha(CON)];total=sum(p.stat().st_size for p in ROOT.rglob('*') if p.is_file())
report={'scope':'owned-runtime-negatives only; not M3/SDK lifecycle gate','sandbox':'none: explicit loopback fixtures, minimal env; no OS network isolation','node':subprocess.check_output([NODE,'--version'],env={'HOME':str(ROOT/'childhang/home'),'TMPDIR':str(ROOT/'childhang'),'PATH':str(pathlib.Path(NODE).parent)}).decode().strip(),'sourceBefore':before,'sourceAfter':after,'results':results,'bytesBeforeFinalReport':total,'limits':{'wallSeconds':90,'parentCPU':30,'childCPU':10,'childWall':10,'outputEach':1048576,'aggregate':4194304},'pass':all(r['pass'] for r in results) and before==after and total<4000000}
(ROOT/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2));sys.exit(0 if report['pass'] else 1)
