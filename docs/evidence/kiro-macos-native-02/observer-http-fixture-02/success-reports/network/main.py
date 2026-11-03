import os,sys,time,json,hashlib,socket,ssl,threading,subprocess,selectors,resource,traceback
from pathlib import Path
ROOT=Path(__file__).resolve().parent
SOURCE=Path('/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02/observer-http-fixture-02/fake-http-tap.cjs')
NODE='/Users/dane/.local/share/pi-node/node-v22.23.2-darwin-arm64/bin/node'
EXPECTED='f21dbb781ae4d106763ef327defd0c47f7100cc358a1343fd30d6997de2fc77a'
START=time.monotonic(); DEADLINE=START+90
resource.setrlimit(resource.RLIMIT_CPU,(30,30))
report={'root':str(ROOT),'commands':[],'sandbox':False,'children':[],'errors':[]}
servers=[]; captures=[]; lock=threading.Lock(); stop=threading.Event(); phase='none'
def digest():return hashlib.sha256(SOURCE.read_bytes()).hexdigest()
def remain():return max(.01,DEADLINE-time.monotonic())
def check(v,msg):
 if not v:raise AssertionError(msg)
def env(d):return {'HOME':str(d/'home'),'TMPDIR':str(d),'PATH':'/usr/bin:/bin','LANG':'C','LC_ALL':'C'}
def bounded(cmd,cwd,e,label,terminal=None):
 report['commands'].append({'label':label,'argv':cmd,'cwd':str(cwd)})
 p=subprocess.Popen(cmd,cwd=cwd,env=e,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
 rec={'label':label,'pid':p.pid};report['children'].append(rec)
 sel=selectors.DefaultSelector(); buffers={'stdout':bytearray(),'stderr':bytearray()}
 for n,f in [('stdout',p.stdout),('stderr',p.stderr)]:os.set_blocking(f.fileno(),False);sel.register(f,selectors.EVENT_READ,n)
 end=min(DEADLINE,time.monotonic()+10); reason=None
 while sel.get_map() or p.poll() is None:
  if time.monotonic()>end:
   reason='deadline';p.kill();break
  for key,_ in sel.select(min(.05,max(.001,end-time.monotonic()))):
   b=os.read(key.fileobj.fileno(),65536)
   if not b:sel.unregister(key.fileobj);continue
   buffers[key.data].extend(b)
   if len(buffers[key.data])>1048576:reason='output-cap';p.kill();break
  if reason:break
 if reason:
  p.wait(timeout=2)
  # No success claimed, preserve already-read bounded bytes.
 else:p.wait(timeout=1)
 rec.update(exit=p.returncode,reason=reason,eof=not bool(sel.get_map()))
 for n,b in buffers.items():(ROOT/(label+'.'+n)).write_bytes(b[:1048576])
 check(reason is None,label+' '+str(reason));check(rec['eof'],label+' no true EOF');check(p.returncode==0,label+' exit '+str(p.returncode))
 if terminal:check(terminal.exists(),label+' missing terminal')
 # Only now interpret stdout as consumable evidence.
 return rec,bytes(buffers['stdout'])
def server(tls=False,context=None):
 s=socket.socket();s.bind(('127.0.0.1',0));s.listen(5);s.settimeout(.1);servers.append(s)
 port=s.getsockname()[1]
 def loop():
  connidx=0
  while not stop.is_set():
   try:c,a=s.accept()
   except socket.timeout:continue
   except OSError:return
   connidx+=1
   try:
    if tls:c=context.wrap_socket(c,server_side=True)
    c.settimeout(.2);buf=bytearray()
    def need(n):
     while len(buf)<n:
      try:b=c.recv(32768)
      except socket.timeout:
       if stop.is_set():raise EOFError()
       continue
      if not b:raise EOFError()
      buf.extend(b)
      check(len(buf)<=200000,'server input cap')
    def line():
     while b'\r\n' not in buf:need(len(buf)+1)
     i=buf.index(b'\r\n')+2;b=bytes(buf[:i]);del buf[:i];return b
    while not stop.is_set():
     head=line()
     while True:
      x=line();head+=x
      if x==b'\r\n':break
     h={x.split(b':',1)[0].lower():x.split(b':',1)[1].strip() for x in head.split(b'\r\n')[1:] if b':' in x}
     raw=bytearray(head);body=bytearray()
     if h.get(b'transfer-encoding')==b'chunked':
      while True:
       z=line();raw.extend(z);n=int(z.strip().split(b';')[0],16)
       if n==0:
        while True:
         z=line();raw.extend(z)
         if z==b'\r\n':break
        break
       check(len(body)+n<=131072,'body cap');need(n+2);raw.extend(buf[:n+2]);body.extend(buf[:n]);del buf[:n+2]
     else:
      n=int(h.get(b'content-length',b'0'));check(n<=131072,'body cap');need(n);raw.extend(buf[:n]);body.extend(buf[:n]);del buf[:n]
     with lock:
      idx=len(captures);stem=phase+('-https-' if tls else '-http-')+str(idx)
      (ROOT/(stem+'.raw')).write_bytes(raw);(ROOT/(stem+'.body')).write_bytes(body)
      captures.append({'phase':phase,'tls':tls,'conn':connidx,'head':head.decode('latin1'),'raw':stem+'.raw','body':stem+'.body'})
     c.sendall(b'HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: keep-alive\r\n\r\nOK')
   except (EOFError,ConnectionError):pass
   except Exception as e:
    with lock:report['errors'].append('server: '+repr(e))
   finally:c.close()
 t=threading.Thread(target=loop,daemon=True);t.start();return port,t
try:
 report['sha_before']=digest();check(report['sha_before']==EXPECTED,'source SHA mismatch')
 for mode in ['control','preload']:
  d=ROOT/mode;d.mkdir();(d/'home').mkdir();(d/'client.cjs').write_bytes((ROOT/'client.cjs').read_bytes())
 certdir=ROOT/'certificate';certdir.mkdir();(certdir/'home').mkdir()
 cmd=['/usr/bin/openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout','key.pem','-out','cert.pem','-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1,DNS:owned.invalid']
 bounded(cmd,certdir,env(certdir),'certificate')
 ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);ctx.load_cert_chain(str(certdir/'cert.pem'),str(certdir/'key.pem'))
 hp,ht=server();sp,st=server(True,ctx);report['ports']={'http':hp,'https':sp}
 results={}
 for mode in ['control','preload']:
  phase=mode;d=ROOT/mode
  (d/'config.json').write_text(json.dumps({'http':hp,'https':sp}));(d/'cert.pem').write_bytes((certdir/'cert.pem').read_bytes())
  e=env(d)
  if mode=='preload':e.update(AXIOM_FAKE_ONLY='only-self-owned-http-fixture',AXIOM_FAKE_TRACE=str(d/'tap.ndjson'),NODE_OPTIONS='--require='+str(SOURCE))
  rec,b=bounded([NODE,str(d/'client.cjs')],d,e,mode,d/'client-terminal.json')
  if mode=='preload':
   status=json.loads((d/'tap.ndjson.status.json').read_text());report['tap_status']=status;check(status['ok'],'tap bad status');check(status['pendingBodyBytes']==0,'tap pending body bytes');check(status['events']<=128 and status['bodyBytes']<=262144 and status['logBytes']<=1048576,'tap caps')
  terminal=json.loads((d/'client-terminal.json').read_text());check(terminal['ok'] and terminal['pid']==rec['pid'],'terminal pid')
  results[mode]=json.loads(b);check(results[mode]['pid']==rec['pid'],'reported pid')
 report['runtime']={k:results['control'][k] for k in ['version','platform','arch']}
 check(results['control']['cases']==results['preload']['cases'],'API result differences')
 a=[x for x in captures if x['phase']=='control'];b=[x for x in captures if x['phase']=='preload'];check(len(a)==len(b)==10,'request count')
 for x,y in zip(a,b):
  check((ROOT/x['raw']).read_bytes()==(ROOT/y['raw']).read_bytes(),'raw request mismatch '+x['raw'])
  body=(ROOT/x['body']).read_bytes();path=x['head'].split(' ')[1]
  expected={'/mixed':bytes.fromhex('c3a9e900ff414243'),'/large':b'L'*98304,'/mutable':b'ZZZZZZ','/invalid':b'','/lexical-get':b'','/after-get':b''}[path]
  check(body==expected,'known body '+path)
 for tls in [False,True]:check(len({x['conn'] for x in a if x['tls']==tls})==1,'keepalive connection not reused')
 for c in results['control']['cases']:
  check(all(v==1 for v in c['cb'].values()),'callback duplicates')
  expected_cb={'mixed':5+1,'large':2,'mutable':2,'invalid':1,'lexical-get':0,'after-get':0}[c['name']]
  check(len(c['cb'])==expected_cb,'callback missing')
  if c['name']=='large':check(c['ret']['large'] is False,'backpressure missing')
  if c['name']=='invalid':check(c['ret']['invalid']=='ERR_INVALID_ARG_TYPE','invalid chunk code')
 events=[json.loads(x) for x in (ROOT/'preload/tap.ndjson').read_text().splitlines()]
 mutable_ids={x['id'] for x in events if x['kind']=='request' and x['path']=='/mutable'}
 import base64
 samples=[base64.b64decode(x['bodyBase64']) for x in events if x.get('id') in mutable_ids and x['kind']=='write' and 'bodyBase64' in x]
 check(samples==[b'BEFORE',b'BEFORE'],'mutable API samples')
 report['negative_boundary']={'API':'BEFORE','received':'ZZZZZZ','count':2,'expected_difference':True}
 report['captures']=captures;report['checks']={'raw_equal':10,'known_bodies':10,'keepalive':True,'callbacks_once':True,'backpressure_false':2,'invalid_errors':2,'mutable_negative':2}
 report['sha_after']=digest();check(report['sha_after']==report['sha_before'],'source changed')
 report['ok']=True
except BaseException as e:
 report['ok']=False;report['failure']=repr(e);report['traceback']=traceback.format_exc();report['sha_after']=digest()
finally:
 stop.set()
 for s in servers:s.close()
 report['elapsed_s']=time.monotonic()-START;report['parent_cpu_s']=time.process_time()
 report['artifacts_bytes']=sum(x.stat().st_size for x in ROOT.rglob('*') if x.is_file())
 if report['artifacts_bytes']>4*1048576:report['ok']=False;report['errors'].append('aggregate artifact cap')
 if report['errors']:report['ok']=False
 (ROOT/'report.json').write_text(json.dumps(report,indent=2))
 print(json.dumps(report,indent=2))
 sys.exit(0 if report['ok'] else 1)
