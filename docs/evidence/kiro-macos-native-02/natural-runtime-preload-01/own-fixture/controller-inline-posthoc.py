import os,sys,time,tempfile,pathlib,hashlib,json,subprocess,selectors,signal,stat,resource
start=time.monotonic(); signal.alarm(35)
root=pathlib.Path(tempfile.mkdtemp(prefix='axiom-startup-own-')); os.chmod(root,0o700)
source=pathlib.Path('/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02/natural-runtime-preload-01/runtime_probe.cjs')
node='/Users/dane/.local/share/pi-node/node-v22.23.2-darwin-arm64/bin/node'
report={'schema':'own-startup-fixture-report-1','executions':0,'pass':False,'auditBlocker':False,'officialExecutions':0,'networkOrServerRequested':False,'exceptions':False}
held={}; identity={}; readbytes=25421; child=None; marker=root/'runtime-marker.json'; rc=1
try:
    before=source.read_bytes(); readbytes+=len(before); digest=hashlib.sha256(before).hexdigest()
    identity={'source':str(source),'bytes':len(before),'sha256Before':digest,'copyBytes':len(before),'copySHA256':hashlib.sha256(before).hexdigest()}
    probe=root/'runtime_probe.cjs'; probe.write_bytes(before); os.chmod(probe,0o400)
    script=root/'acp-server.js'; script.write_bytes(b"'use strict';\n"); os.chmod(script,0o400)
    home=root/'home'; tmp=root/'tmp'; home.mkdir(mode=0o700); tmp.mkdir(mode=0o700)
    env={'HOME':str(home),'TMPDIR':str(tmp),'PATH':str(pathlib.Path(node).parent),'LANG':'C','LC_ALL':'C','NODE_OPTIONS':'--require='+str(probe)}
    def limits():
        resource.setrlimit(resource.RLIMIT_CORE,(0,0))
        resource.setrlimit(resource.RLIMIT_CPU,(2,3))
        _,hard=resource.getrlimit(resource.RLIMIT_NOFILE)
        n=64 if hard==resource.RLIM_INFINITY else min(64,hard)
        resource.setrlimit(resource.RLIMIT_NOFILE,(n,n))
    argv=[node,str(script),'--transport=stdio','--auth=acp-callback','--synthetic-private-canary-91cd2']
    ns=time.monotonic(); deadline=ns+5
    child=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,cwd=root,env=env,close_fds=True,preexec_fn=limits)
    report['executions']=1
    held={'schema':'own-held-node-1','pid':child.pid,'exit':None,'stdoutBytes':0,'stderrBytes':0,'stdoutEOF':False,'stderrEOF':False,'fault':None,'directChildOnly':True}
    selector=selectors.DefaultSelector()
    for name,stream in [('stdout',child.stdout),('stderr',child.stderr)]:
        os.set_blocking(stream.fileno(),False); selector.register(stream,selectors.EVENT_READ,name)
    while selector.get_map() and held['fault'] is None:
        remain=deadline-time.monotonic()
        if remain<=0: held['fault']='deadline'; break
        for key,_ in selector.select(min(remain,.05)):
            chunk=os.read(key.fd,8192)
            if chunk:
                held[key.data+'Bytes']+=len(chunk)
                if held[key.data+'Bytes']>8192: held['fault']='pipe-cap'; break
            else:
                held[key.data+'EOF']=True; selector.unregister(key.fileobj); key.fileobj.close()
    selector.close()
    if held['fault'] is None:
        try: child.wait(timeout=max(.001,deadline-time.monotonic()))
        except subprocess.TimeoutExpired: held['fault']='deadline'
    if child.poll() is None: child.kill()
    try: child.wait(timeout=2)
    except subprocess.TimeoutExpired: held['fault']='reap-deadline'
    held['exit']=child.returncode; held['wallSeconds']=time.monotonic()-ns
    for stream in (child.stdout,child.stderr): stream.close()
    fd=os.open(marker,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        st=os.fstat(fd)
        if not(stat.S_ISREG(st.st_mode) and st.st_uid==os.getuid() and stat.S_IMODE(st.st_mode)==0o400 and st.st_nlink==1 and st.st_size<=2048): raise ValueError()
        raw=os.read(fd,2049); readbytes+=len(raw)
    finally: os.close(fd)
    def pairs(ps):
        d={}
        for k,v in ps:
            if k in d: raise ValueError()
            d[k]=v
        return d
    def reject(x): raise ValueError()
    data=json.loads(raw,object_pairs_hook=pairs,parse_constant=reject,parse_float=reject)
    expected={'schema':'startup-public-marker-1','selfPID':child.pid,'selfParentPID':os.getpid(),'nodeVersion':'v22.23.2','platform':'darwin','architecture':'arm64','scriptLeafMatches':True,'stdio':True,'ws':False,'acpCallback':True,'roleCandidate':'kas-stdio-acp-callback','httpPatched':False,'rawArgumentsPersisted':False,'senderProved':False}
    valid=type(data) is dict and set(data)==set(expected) and len(data)==14 and all(type(data[k]) is type(v) and data[k]==v for k,v in expected.items())
    noleak=all(s not in raw for s in [argv[-1].encode(),str(root).encode(),b'NODE_OPTIONS',b'HOME',b'TMPDIR',b'unknownargs']) and all('/' not in v and '\\' not in v for v in data.values() if type(v) is str)
    after=source.read_bytes(); readbytes+=len(after); identity['sha256After']=hashlib.sha256(after).hexdigest(); identity['unchanged']=before==after
    report.update({'markerValidClosed14':valid,'markerNoCanaryUnknownArgsPathEnvironment':noleak,'markerBytes':len(raw),'markerCount':len(list(root.glob('runtime-marker.json'))),'minimalEnvironmentKeyCount':len(env),'measuredContentReadBytesIncludingPriorToolReads':readbytes,'readCapBytes':32768,'sourceUnchanged':before==after,'nodeWallLimitSeconds':7,'captureWallSeconds':5,'reapSeconds':2,'pipeCapBytes':8192,'runtimeVersion':data.get('nodeVersion') if valid else None,'runtimePlatform':data.get('platform') if valid else None,'runtimeArchitecture':data.get('architecture') if valid else None,'roleCandidate':data.get('roleCandidate') if valid else None,'selfPIDMatchesHeld':valid and data['selfPID']==child.pid,'selfParentPIDMatchesCaller':valid and data['selfParentPID']==os.getpid(),'readBudgetBasis':'prior full read byte sizes plus every source and marker content read; OS runtime-loader reads excluded','wholeTaskWallSeconds':'unknown'})
    report['pass']=valid and noleak and before==after and readbytes<=32768 and held['exit']==0 and held['stdoutEOF'] and held['stderrEOF'] and held['stdoutBytes']==0 and held['stderrBytes']==0 and held['fault'] is None and held['wallSeconds']<=7
    if not valid or not noleak: marker.unlink()
    rc=0 if report['pass'] else 1
except BaseException:
    report['exceptions']=True
    if child is not None:
        try:
            if child.poll() is None: child.kill()
            child.wait(timeout=2); held['exit']=child.returncode
        except BaseException: held['cleanupUnverified']=True
    try: marker.unlink(missing_ok=True)
    except BaseException: pass
finally:
    report['experimentWallSeconds']=time.monotonic()-start
    report['harnessExitCode']=rc
    for name,value in [('safe-report.json',report),('held.json',held),('source-identity.json',identity)]:
        p=root/name
        with p.open('x') as f: json.dump(value,f,sort_keys=True,indent=2); f.write('\n')
        os.chmod(p,0o400)
    print(json.dumps({'artifactRoot':str(root),'harnessExitCode':rc,'pass':report['pass'],'held':held,'sourceIdentity':identity,'readBytes':readbytes,'experimentWallSeconds':report['experimentWallSeconds']},sort_keys=True))
sys.exit(rc)
