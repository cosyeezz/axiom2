import os,sys,json,hashlib,resource,signal,time,subprocess,selectors,stat
from pathlib import Path
R=Path(__file__).parent
resource.setrlimit(resource.RLIMIT_CPU,(10,10));resource.setrlimit(resource.RLIMIT_CORE,(0,0));resource.setrlimit(resource.RLIMIT_FSIZE,(65536,65536));resource.setrlimit(resource.RLIMIT_NOFILE,(64,64))
def alarm(s,f):raise TimeoutError()
signal.signal(signal.SIGALRM,alarm);signal.alarm(15)
NAMES=['adrp_signed','adrp_reject','add_shift','add_reject','uleb_valid','uleb_shape','uleb_range','uleb_overflow','uleb_terminator','read_correct','read_reject','scan_four_bounds','scan_window','scan_cap']
COUNTS=[7,5,5,7,3,6,4,3,6,4,7,9,3,6]
def require(b):
    if not b:raise ValueError()
def load(raw):
    def pairs(items):
        d={}
        for k,v in items:
            if k in d:raise ValueError()
            d[k]=v
        return d
    def reject(_):raise ValueError()
    return json.loads(raw,object_pairs_hook=pairs,parse_constant=reject,parse_float=reject)
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def metadata(p):
    s=p.stat();return {'device':s.st_dev,'inode':s.st_ino,'size':s.st_size,'mode':stat.S_IMODE(s.st_mode),'uid':s.st_uid,'mtimeNS':s.st_mtime_ns,'ctimeNS':s.st_ctime_ns}
def write(p,v):
    b=(json.dumps(v,sort_keys=True,indent=2)+'\n').encode();require(len(b)<=8192)
    with p.open('xb') as f:f.write(b)
def limits():
    resource.setrlimit(resource.RLIMIT_CPU,(2,3));resource.setrlimit(resource.RLIMIT_CORE,(0,0));resource.setrlimit(resource.RLIMIT_FSIZE,(65536,65536));resource.setrlimit(resource.RLIMIT_NOFILE,(32,32));signal.alarm(5)
def gate(d):
    require(type(d)is dict and set(d)=={'status','cases','assertions','environment','tinyFD','ramRestored'})
    require(d['status']=='pass' and type(d['assertions'])is int and d['assertions']==sum(COUNTS)<=96 and d['ramRestored'] is True)
    require(type(d['cases'])is list and len(d['cases'])==14)
    for row,n,k in zip(d['cases'],NAMES,COUNTS):require(type(row)is dict and set(row)=={'name','assertions'} and row['name']==n and type(row['assertions'])is int and row['assertions']==k)
    e=d['environment'];require(type(e)is dict and set(e)=={'expectedSixPresent','onlyDocumentedExtras','actualKeyCount','platformExtraCount'})
    require(e['expectedSixPresent'] is True and e['onlyDocumentedExtras'] is True and type(e['actualKeyCount'])is int and type(e['platformExtraCount'])is int and 0<=e['platformExtraCount']<=6 and e['actualKeyCount']==6+e['platformExtraCount'])
    t=d['tinyFD'];require(type(t)is dict and set(t)=={'size','stable','regular','owned'} and type(t['size'])is int and t['size']==10 and all(t[k] is True for k in ['stable','regular','owned']))
    return d
p=None;start=time.monotonic();outcome={'status':'controller-failed'}
try:
    require(stat.S_IMODE(R.stat().st_mode)==0o700 and R.stat().st_uid==os.getuid())
    with (R/'RUN_ONCE').open('xb') as f:f.write(b'catalog-xref-unit01-one-worker\n')
    manifest=load((R/'prelaunch.json').read_bytes())
    before={n:{'sha256':digest(R/n),'metadata':metadata(R/n)} for n in ['source.py','harness.py','controller.py']}
    require(before==manifest['files'])
    require(before['source.py']['sha256']=='bb5c054173e3aaf6574a1a8db190be415e1bceb08a1728386420e953e5f53e2f')
    env={'HOME':str(R),'TMPDIR':str(R),'PATH':'/usr/bin:/bin','LANG':'C','LC_ALL':'C','PYTHONHASHSEED':'0'}
    launch=time.monotonic()
    p=subprocess.Popen(['/usr/bin/python3','-I','-B',str(R/'harness.py')],cwd=str(R),env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,close_fds=True,preexec_fn=limits,start_new_session=True)
    sel=selectors.DefaultSelector();sel.register(p.stdout,selectors.EVENT_READ,'stdout');sel.register(p.stderr,selectors.EVENT_READ,'stderr')
    chunks={'stdout':bytearray(),'stderr':bytearray()};eofs={'stdout':False,'stderr':False};received=0
    while sel.get_map():
        left=5-(time.monotonic()-launch)
        if left<=0:raise TimeoutError()
        for key,_ in sel.select(min(left,0.1)):
            b=os.read(key.fileobj.fileno(),min(4096,8193-received))
            if not b:eofs[key.data]=True;sel.unregister(key.fileobj);continue
            received+=len(b);require(received<=8192);chunks[key.data].extend(b)
    sel.close();actual=p.wait(timeout=max(0.001,5-(time.monotonic()-launch)));runtime=time.monotonic()-launch
    # Stream contents are held in memory only until this closed-schema gate passes.
    require(actual==0 and not chunks['stderr'] and all(eofs.values()))
    result=gate(load(bytes(chunks['stdout'])))
    after={n:{'sha256':digest(R/n),'metadata':metadata(R/n)} for n in before}
    require(before==after)
    held={'pid':p.pid,'actualExitCode':actual,'stdoutEOF':eofs['stdout'],'stderrEOF':eofs['stderr'],'collectedBytes':received,'workerWallSeconds':runtime,'controllerSecondsBeforePublication':time.monotonic()-start,'sourceHarnessControllerStable':True,'before':before,'after':after}
    write(R/'held-metadata.json',held)
    report={'status':'pass','worker':result,'pid':p.pid,'actualExitCode':actual,'stdoutEOF':True,'stderrEOF':True,'workerWallSeconds':runtime,'sourceSHA256':before['source.py']['sha256'],'limits':{'workerCPU':[2,3],'controllerCPU':[10,10],'workerWall':5,'cleanup':2,'outer':15,'core':0,'fileSize':65536,'pipeTotalBytes':8192,'reportBytes':8192,'directoryTotalBytes':131072,'workerNOFILE':32,'controllerNOFILE':64},'scope':{'targetAccess':False,'mainOrRunOnceCalled':False,'network':False,'sourceChanged':False,'oneWorker':True,'wholeAuthorTimingMeasured':False,'peakRSSMeasured':False,'controllerFailureBranchesTested':False},'environmentPolicy':{'explicitKeyCount':6,'documentedOptionalPlatformKeys':['__CF_USER_TEXT_ENCODING','LC_CTYPE','VERSIONER_PYTHON_VERSION','VERSIONER_PYTHON_PREFER_32_BIT','__PYVENV_LAUNCHER__','PYTHONEXECUTABLE']},'timingNotes':'Worker wall spans Popen creation through held exit+EOF. Controller interval starts after interpreter imports and limit setup, before marker; authoring and interpreter startup not measured. No claim of whole-author 120 seconds. No benchmark of real scan; no controller adverse-branch certification.'}
    encoded=(json.dumps(report,sort_keys=True,indent=2)+'\n').encode();require(len(encoded)<=8192)
    require(sum(x.stat().st_size for x in R.iterdir() if x.is_file())+len(encoded)<=131072)
    write(R/'report.json',report)
    outcome={'status':'pass','cases':14,'assertions':sum(COUNTS),'pid':p.pid,'actualExitCode':actual,'stdoutEOF':True,'stderrEOF':True}
except BaseException:
    # No exception text, stack, raw stream or unknown-error hash is persisted.
    if p is not None and p.poll() is None:
        try:p.kill();p.wait(timeout=2)
        except BaseException:pass
    try:
        outcome={'status':'controller-failed','workerStarted':p is not None,'workerExited':p is not None and p.poll() is not None}
        write(R/'failure.json',outcome)
    except BaseException:outcome={'status':'controller-failed'}
finally:
    signal.alarm(0)
    if p is not None:
        for f in [p.stdout,p.stderr]:
            if f is not None:f.close()
print(json.dumps(outcome,sort_keys=True))
sys.exit(0 if outcome['status']=='pass' else 1)
