import sys
sys.dont_write_bytecode=True
import os, ast, json, hashlib, pathlib, subprocess, selectors, time, resource, difflib
ROOT=pathlib.Path(__file__).parent
BASE=pathlib.Path('/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02')
SOURCE=BASE/'observer-http-fixture-04/terminal_consumer.py'
OLD=BASE/'observer-http-fixture-03/reports/consumer'
SHA='4d848742029ed86dd8769a0dc2280312cd92002fc8d44e645e4777692e8def1f'
START=time.monotonic(); DEADLINE=START+90
resource.setrlimit(resource.RLIMIT_CPU,(30,30))
resource.setrlimit(resource.RLIMIT_FSIZE,(1048576,1048576))
def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def write(name,data):
    if not isinstance(data,bytes): data=data.encode()
    with (ROOT/name).open('xb') as f:f.write(data)
def dump(name,obj):write(name,json.dumps(obj,ensure_ascii=True,indent=2)+'\n')
def tracked():
    paths=[SOURCE, BASE/'observer-http-fixture-04/EXPERIMENT.md',BASE/'observer-http-fixture-02/terminal_consumer.py']+sorted(p for p in OLD.iterdir() if p.is_file())
    return {str(p):digest(p) for p in paths}
before=tracked(); assert digest(SOURCE)==SHA
raw=(OLD/'runner.py').read_text()
oldpath='/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02/observer-http-fixture-02/terminal_consumer.py'
oldsha='0a4871784b92e07baa43f9ad2395e95d6ac0b5250ec390e548f05a9b61193bdf'
assert raw.count(oldpath)==raw.count(oldsha)==1
new=raw.replace(oldpath,str(SOURCE)).replace(oldsha,SHA)
assert new.replace(str(SOURCE),oldpath).replace(SHA,oldsha)==raw
# Independently normalize only the two binding constants in the AST.
def normalize(text):
    tree=ast.parse(text)
    for n in ast.walk(tree):
        if isinstance(n,ast.Constant) and isinstance(n.value,str):
            if n.value in (oldpath,str(SOURCE)):n.value='SOURCE_BINDING'
            elif n.value in (oldsha,SHA):n.value='SHA_BINDING'
    return ast.dump(tree,include_attributes=False)
assert normalize(raw)==normalize(new)
write('runner.py',new)
write('runner.diff',''.join(difflib.unified_diff(raw.splitlines(True),new.splitlines(True),fromfile=str(OLD/'runner.py'),tofile=str(ROOT/'runner.py'))))
# Verify the implementation delta is only the explicitly specified depth preflight.
oldsrc=(BASE/'observer-http-fixture-02/terminal_consumer.py').read_text()
src=SOURCE.read_text(); const='MAX_JSON_DEPTH = 16\n'
start=src.index('    # Explicit version-independent bound before the recursive JSON parser.\n')
end=src.index('    def pairs(items):',start)
assert src[:start].replace(const,'')+src[end:]==oldsrc
write('source.diff',''.join(difflib.unified_diff(oldsrc.splitlines(True),src.splitlines(True),fromfile='consumer02',tofile='consumer04')))
for dest,origin,expected in [('snapshot.ndjson','snapshot.ndjson','6402099fc5a1f1265c40430e2f878755b8f940fe32c414b68dc16870548d6982'),('snapshot.status.json','snapshot.status.json','be915c3dce588571b43d568df157b010cb69fd9abe00fe119bb2a0bd3b08f514')]:
    assert digest(OLD/origin)==expected
    write(dest,(OLD/origin).read_bytes());assert digest(ROOT/dest)==expected
oldreport=json.loads((OLD/'summary.json').read_text())
assert [(r['total'],r['passed'],r['failed'],r['exit_code']) for r in oldreport['results']]==[(270,270,0,0),(270,269,1,1)]
assert oldreport['results'][1]['failures']==[{'name':'json_depth','pass':False,'outcome':'accepted'}]
dump('binding-audit.json',{'original_runner':str(OLD/'runner.py'),'original_sha':digest(OLD/'runner.py'),'new_runner_sha':digest(ROOT/'runner.py'),'text_inverse_exact':True,'normalized_ast_identical':True,'only_changes':['source path','source SHA'],'root_binding':'unchanged argv[1], new independent root','implementation_delta':'exacttext only MAX_JSON_DEPTH and preflight','historical_results_preserved':oldreport['results']})
# Separate new depth contract checks; no changes to original 270-case oracles.
boundary=r'''import sys
sys.dont_write_bytecode=True
import importlib.util, hashlib, json, resource, time
resource.setrlimit(resource.RLIMIT_CPU,(8,8))
resource.setrlimit(resource.RLIMIT_FSIZE,(1048576,1048576))
source=sys.argv[1]; sha=hashlib.sha256(open(source,'rb').read()).hexdigest()
assert sha==sys.argv[2]
spec=importlib.util.spec_from_file_location('depth_consumer',source)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
assert m.MAX_JSON_DEPTH==16
results=[];active=False;violations=[]
def audit(event,args):
    if active and (event=='open' or event.startswith(('socket.','subprocess.','os.system','os.exec','os.spawn','ctypes.'))):
        violations.append(event);raise RuntimeError('unexpected I/O '+event)
sys.addaudithook(audit)
def check(name,raw,valid):
    global active
    active=True
    try:m.strict_json(raw,100000)
    except ValueError as e:results.append(dict(name=name,passed=not valid,outcome='ValueError',reason=str(e)))
    except BaseException as e:results.append(dict(name=name,passed=False,outcome=type(e).__name__,reason=str(e)))
    else:results.append(dict(name=name,passed=valid,outcome='accepted'))
    finally:active=False
for depth in (0,1,15,16,17,2000,40000):
    check('arrays_depth_'+str(depth),b'['*depth+b'0'+b']'*depth,depth<=16)
for depth in (16,17):
    check('objects_depth_'+str(depth),b'{"a":'*depth+b'0'+b'}'*depth,depth<=16)
    opens=[b'[' if i%2==0 else b'{"a":' for i in range(depth)]
    closes=[b']' if i%2==0 else b'}' for i in range(depth)]
    check('mixed_depth_'+str(depth),b''.join(opens)+b'0'+b''.join(reversed(closes)),depth<=16)
for name,value in [('brackets_in_string','[]{}'*100),('escaped_quote','"'+'['*80),('escaped_backslash','\\'*3+'{'*80),('unicode','\u2603[]{}'),('controls','\n\t"\\[]')]:
    check(name,json.dumps(value,ensure_ascii=True).encode(),True)
    check(name+'_at_depth16',b'['*16+json.dumps(value,ensure_ascii=True).encode()+b']'*16,True)
for name,raw in [('unicode_escape',b'"\\u005b\\u007b\\u005d\\u007d"'),('utf8_valid','"\u2603"'.encode())]:check(name,raw,True)
for name,raw in [('mismatched',b'[}'),('extra_close',b'[]]'),('incomplete_array',b'['),('incomplete_object',b'{"a":0'),('incomplete_string',b'"['),('dangling_escape',b'"abc\\'),('bad_escape',b'"\\q"'),('trailing_comma',b'[0,]'),('invalid_utf8',b'"\xff"'),('invalid_utf8_with_bracket',b'"\xff["'),('bad_unicode_escape',b'"\\uZZZZ"')]:check(name,raw,False)
post=hashlib.sha256(open(source,'rb').read()).hexdigest();assert sha==post and not violations
report=dict(python=sys.version,executable=sys.executable,source_sha_before=sha,source_sha_after=post,total=len(results),passed=sum(r['passed'] for r in results),failed=sum(not r['passed'] for r in results),cases=results,audit_violations=violations,cpu_seconds=time.process_time())
print(json.dumps(report,indent=2));sys.exit(1 if report['failed'] else 0)
'''
write('boundary.py',boundary)
env={'HOME':str(ROOT/'home'),'TMPDIR':str(ROOT/'tmp'),'PATH':'/usr/bin:/bin','LC_ALL':'C','PYTHONDONTWRITEBYTECODE':'1'}
results=[]
def run(label,exe,script,args):
    cmd=[exe,'-I','-B',str(ROOT/script)]+args
    p=subprocess.Popen(cmd,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,cwd=str(ROOT),env=env)
    sel=selectors.DefaultSelector(); buffers={'stdout':bytearray(),'stderr':bytearray()};eof={'stdout':False,'stderr':False}
    for key,stream in [('stdout',p.stdout),('stderr',p.stderr)]:os.set_blocking(stream.fileno(),False);sel.register(stream,selectors.EVENT_READ,key)
    began=time.monotonic();timeout=False;overflow=False
    while sel.get_map() or p.poll() is None:
        now=time.monotonic()
        if now>=min(DEADLINE,began+20) and not timeout:
            timeout=True
            if p.poll() is None:p.kill()
        if overflow and p.poll() is None:p.kill()
        for key,_ in sel.select(0.05):
            chunk=os.read(key.fileobj.fileno(),65536)
            name=key.data
            if not chunk: eof[name]=True;sel.unregister(key.fileobj);key.fileobj.close()
            elif len(buffers[name])+len(chunk)>1048576:
                buffers[name].extend(chunk[:1048576-len(buffers[name])]);overflow=True
            else:buffers[name].extend(chunk)
    code=p.wait();sel.close()
    for name,data in buffers.items():write(label+'.'+name+('.json' if name=='stdout' else '.log'),bytes(data))
    report=None;parse_error=None
    try:report=json.loads(buffers['stdout'])
    except Exception as e:parse_error=repr(e)
    result=dict(label=label,command=cmd,cwd=str(ROOT),exit_code=code,timed_out=timeout,output_cap_exceeded=overflow,stdin='DEVNULL (immediate real EOF)',eof=eof,elapsed_seconds=time.monotonic()-began,stdout_bytes=len(buffers['stdout']),stderr_bytes=len(buffers['stderr']),parse_error=parse_error)
    if report:
        for k in ['python','executable','source_sha_before','source_sha_after','total','passed','failed','cpu_seconds','audit_violations']:result[k]=report.get(k)
        result['failures']=[r for r in report['cases'] if not r.get('pass',r.get('passed',False))]
    results.append(result)
    dump('progress-'+label+'.json',result)
    assert resource.getrusage(resource.RUSAGE_SELF).ru_utime+resource.getrusage(resource.RUSAGE_SELF).ru_stime+resource.getrusage(resource.RUSAGE_CHILDREN).ru_utime+resource.getrusage(resource.RUSAGE_CHILDREN).ru_stime<30
for label,exe in [('py39','/usr/bin/python3'),('py314','/Users/dane/.pyenv/versions/3.14.7/bin/python3')]:
    run(label,exe,'runner.py',[str(ROOT)])
    run(label+'-boundary',exe,'boundary.py',[str(SOURCE),SHA])
after=tracked()
passed=before==after and all(r['exit_code']==0 and not r['timed_out'] and not r['output_cap_exceeded'] and all(r['eof'].values()) and r.get('failed')==0 and r.get('source_sha_before')==r.get('source_sha_after')==SHA for r in results)
assert [r['total'] for r in results if 'boundary' not in r['label']]==[270,270]
summary=dict(passed=passed,root=str(ROOT),controller_command=[sys.executable,'-I','-B',str(ROOT/'controller.py')],environment=env,results=results,before=before,after=after,unchanged=before==after,elapsed_seconds=time.monotonic()-START,unique_original_suite_cases=270,additional_boundary_cases_per_version=results[1].get('total'),safety='pure only; no network/Node/official/model/real HOME or credentials; audit is not OS sandbox',not_run=['original 30 pure calibration','HTTP/network tests','old03 controller','official/M3/model/server parity'])
dump('summary.json',summary)
manifest={p.name:{'bytes':p.stat().st_size,'sha256':digest(p)} for p in sorted(ROOT.iterdir()) if p.is_file()}
dump('manifest.json',manifest)
size=sum(p.stat().st_size for p in ROOT.rglob('*') if p.is_file());assert size<=4194304
print(json.dumps({'root':str(ROOT),'passed':passed,'bytes':size,'results':results,'elapsed_seconds':summary['elapsed_seconds']},indent=2))
sys.exit(0 if passed else 1)
