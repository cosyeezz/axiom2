import os,sys,json,subprocess,time,selectors,hashlib,pathlib
ROOT=pathlib.Path(__file__).resolve().parent
M=json.loads((ROOT/'manifest.json').read_text())
env={'HOME':str(ROOT/'home'),'TMPDIR':str(ROOT/'tmp'),'TMP':str(ROOT/'tmp'),'TEMP':str(ROOT/'tmp'),'PATH':'/usr/bin:/bin'}
report={'controller_schema':'own-controller-1','tool_numeric_exit':'unknown','environment_keys':sorted(env),'debug_proxy_env_present':False,'stdin':'DEVNULL: EOF from start','commands':[]}
start=time.monotonic()
cmd=['/usr/bin/openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-config',str(ROOT/'openssl.cnf'),'-keyout',str(ROOT/'key.pem'),'-out',str(ROOT/'cert.pem')]
report['commands'].append(cmd)
try:
 p=subprocess.Popen(cmd,cwd=ROOT,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 report['openssl_held_pid']=p.pid
 try: rc=p.wait(timeout=12)
 except subprocess.TimeoutExpired: p.kill();rc=p.wait();report['openssl_timed_out']=True
 report['openssl_wait_exit']=rc
 if rc!=0: raise RuntimeError('fixed-cert-failure')
 os.chmod(ROOT/'key.pem',0o600);os.chmod(ROOT/'cert.pem',0o600)
 cmd=[M['node'],str(ROOT/'harness.cjs')];report['commands'].append(cmd)
 p=subprocess.Popen(cmd,cwd=ROOT,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 report['node_held_pid']=p.pid;report['held_pid_source']='Popen owned child, retained until wait'
 sel=selectors.DefaultSelector();sel.register(p.stdout,selectors.EVENT_READ,'stdout');sel.register(p.stderr,selectors.EVENT_READ,'stderr')
 counts={'stdout':0,'stderr':0};eof={'stdout':False,'stderr':False};caps={'stdout':65536,'stderr':8192};output=bytearray();deadline=time.monotonic()+18;stop=False
 while sel.get_map():
  if time.monotonic()>=deadline and not stop: report['node_timed_out']=True;p.kill();stop=True
  for key,_ in sel.select(0.05):
   n=key.data;b=os.read(key.fd,min(4096,caps[n]-min(counts[n],caps[n]))+1)
   if not b: eof[n]=True;sel.unregister(key.fileobj);key.fileobj.close();continue
   counts[n]+=len(b)
   if counts[n]>caps[n]:
    report['output_cap_exceeded']=n
    if not stop:p.kill();stop=True
   elif n=='stdout': output.extend(b)
  if stop and time.monotonic()>deadline+2:break
 rc=p.wait(timeout=2);report['node_wait_exit']=rc;report['eof']=eof;report['output_byte_counts']=counts
 # stdout is exclusively the frozen own harness fixed scalar projection; stderr is counted, never saved.
 if not report.get('output_cap_exceeded'):
  try:
   data=json.loads(output);(ROOT/'results.json').write_text(json.dumps(data,indent=2)+'\n');report['harness_pass']=data.get('pass') is True
  except Exception: report['projection_parse_failure']=True
 report['exit_code']=rc
except Exception:
 report['controller_failure']='fixed-controller-failure';report['exit_code']=1
finally:
 report['source_after']={n:{'bytes':(pathlib.Path(M['source'])/n).stat().st_size,'sha256':hashlib.sha256((pathlib.Path(M['source'])/n).read_bytes()).hexdigest()} for n in M['source_before']}
 report['source_unchanged']=report['source_after']==M['source_before'];report['elapsed_seconds']=round(time.monotonic()-start,3)
 report['own_artifacts_sha256']={n:hashlib.sha256((ROOT/n).read_bytes()).hexdigest() for n in ['manifest.json','controller.py','harness.cjs']}
 (ROOT/'controller-report.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({'artifact_root':str(ROOT),'node_wait_exit':report.get('node_wait_exit'),'harness_pass':report.get('harness_pass'),'source_unchanged':report['source_unchanged'],'elapsed_seconds':report['elapsed_seconds']}))
sys.exit(report['exit_code'])
