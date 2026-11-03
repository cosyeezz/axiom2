import ast, copy, difflib, hashlib, json, os, pathlib, resource, signal, subprocess, sys, time
ROOT=pathlib.Path(__file__).parent
REPO=pathlib.Path('/Volumes/D_Work/axiom2')
BASE=REPO/'docs/evidence/kiro-macos-native-02'
OLD=BASE/'observer-http-fixture-02/terminal_consumer.py'
NEW=BASE/'observer-http-fixture-04/terminal_consumer.py'
EXPECT=['0a4871784b92e07baa43f9ad2395e95d6ac0b5250ec390e548f05a9b61193bdf','4d848742029ed86dd8769a0dc2280312cd92002fc8d44e645e4777692e8def1f']
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def save(name,value):
    with (ROOT/name).open('x') as f: json.dump(value,f,ensure_ascii=True,indent=2)
def worker():
    resource.setrlimit(resource.RLIMIT_CPU,(12,12))
    resource.setrlimit(resource.RLIMIT_FSIZE,(1048576,1048576))
    ns={}; exec(compile(NEW.read_bytes(),str(NEW),'exec'),ns)
    strict=ns['strict_json']; validate=ns['validate_capture']; results=[]
    def test(name,fn,accept=True,want=None,check=False):
        try:
            got=fn()
            good=accept and (not check or got==want)
            detail='accepted' if good else 'unexpected acceptance/value'
        except ValueError as e:
            good=not accept; detail=type(e).__name__+': '+str(e)[:120]
        except Exception as e:
            good=False; detail='NON_VALUE_ERROR '+type(e).__name__+': '+str(e)[:120]
        results.append({'case':name,'pass':good,'result':detail})
    def raw(name,b,accept=True,want=None,check=False):
        test(name,lambda:strict(b,1048576),accept,want,check)
    def wrap(n,kind,leaf=b'0'):
        for i in range(n):
            leaf=(b'['+leaf+b']') if kind=='array' or (kind=='mixed' and i%2==0) else b'{"x":'+leaf+b'}'
        return leaf
    for kind in ['array','object','mixed']:
        for n in [0,1,15,16,17,2000]: raw('%s-depth-%d'%(kind,n),wrap(n,kind),n<=16)
    for n in [0,1,2,3,4,5,6,7,8,9]:
        val='\\'*n+'"'+'[{'*50+'}]'*50+'\\'*n
        b=json.dumps(val).encode()
        raw('escaped-parity-%d'%n,b,True,val,True)
        raw('depth16-escaped-%d'%n,wrap(16,'mixed',b))
    huge='[{'*100000+'}]'*100000
    raw('huge-brackets-quoted',json.dumps(huge).encode(),True,huge,True)
    raw('depth16-huge-brackets-quoted',wrap(16,'mixed',json.dumps(huge).encode()))
    raw('unicode-escaped-structurals',b'"\\u005b\\u007b\\u0022\\u005c\\u005d\\u007d"',True,'[{"\\]}',True)
    raw('unicode-escaped-depth16',wrap(16,'mixed',b'"\\u005b\\u007b\\u0022\\u005c"'))
    text='中文😀é[{}]"\\'
    raw('actual-utf8',json.dumps(text,ensure_ascii=False).encode(),True,text,True)
    raw('utf8-depth16',wrap(16,'mixed',json.dumps(text,ensure_ascii=False).encode()))
    invalid=[b'[',b'}',b'[]]',b'[[0]',b'{"a":1',b'[}',b'{]',b'"partial',b'"partial\\',b'"partial\\\\',b'"bad\\q"',b'"\\u12"',b'"\\uXXXX"',b'"a\n"',b'"\xff"',b'"\xc0\xaf"',b'[]{}',b'[1,]',b'{"a":}',b'{"a":1,"a":2}',b'{"a":1,"\\u0061":2}',b'NaN',b'1.0']
    for i,b in enumerate(invalid): raw('invalid-%02d'%i,b,False)
    # Spy proves over-depth stops before loads, while valid 16 reaches existing parser.
    realjson=ns['json']
    class Spy:
        def __init__(self): self.calls=0
        def loads(self,*a,**k): self.calls+=1; return realjson.loads(*a,**k)
    spy=Spy(); ns['json']=spy
    raw('pre-parser-depth17',wrap(17,'mixed'),False)
    test('pre-parser-not-called',lambda:spy.calls,True,0,True)
    raw('pre-parser-depth16',wrap(16,'mixed'))
    test('parser-called-at16',lambda:spy.calls,True,1,True)
    ns['json']=realjson
    fixture=BASE/'observer-http-fixture-02/success-reports/network/preload'
    status=(fixture/'tap.ndjson.status.json').read_bytes(); trace=(fixture/'tap.ndjson').read_bytes()
    test('preserved-flat-capture',lambda:len(validate(status,trace,scope=ns['SCOPE'],expected_requests=10)['requests']),True,10,True)
    s=json.loads(status)
    for label,key,value in [('extra','extra',1),('bool-count','events',True),('pending','pendingBodyBytes',1),('request-count','requests',9)]:
        bad=dict(s); bad[key]=value
        test('schema-'+label,lambda bad=bad:validate(json.dumps(bad).encode(),trace,scope=ns['SCOPE'],expected_requests=10),False)
    test('schema-wrong-scope',lambda:validate(status,trace,scope='official',expected_requests=10),False)
    test('schema-nested-status',lambda:validate(b'[]',trace,scope=ns['SCOPE'],expected_requests=10),False)
    record={'version':sys.version,'executable':sys.executable,'flags':str(sys.flags),'HOME':os.environ['HOME'],'TMPDIR':os.environ['TMPDIR'],'source_sha':sha(NEW),'fixture_sha':{'status':hashlib.sha256(status).hexdigest(),'trace':hashlib.sha256(trace).hexdigest()},'unique_cases':len(results),'passed':sum(r['pass'] for r in results),'results':results}
    print(json.dumps(record,ensure_ascii=True))
    return 0 if all(r['pass'] for r in results) else 1

def main():
    signal.signal(signal.SIGALRM,lambda *_:sys.exit(124)); signal.alarm(90)
    resource.setrlimit(resource.RLIMIT_CPU,(6,6))
    resource.setrlimit(resource.RLIMIT_FSIZE,(1048576,1048576))
    before=[sha(OLD),sha(NEW)]; assert before==EXPECT,before
    old=OLD.read_text(); new=NEW.read_text()
    start=new.index('    # Explicit version-independent bound')
    stop=new.index('    def pairs(items):',start)-1
    reconstructed=new[:start]+new[stop:]
    reconstructed=reconstructed.replace('MAX_JSON_DEPTH = 16\n','',1)
    assert reconstructed==old,'unexpected text delta'
    tree=ast.parse(new)
    imports=[ast.unparse(n) for n in tree.body if isinstance(n,(ast.Import,ast.ImportFrom))]
    assert imports==['import base64','import json'],imports
    # Only compile/import inert declarations; no top-level calls or process/file/network additions.
    assert all(isinstance(n,(ast.Expr,ast.Import,ast.Assign,ast.FunctionDef)) for n in tree.body)
    added=ast.parse('def preflight(raw):\n'+new[start:stop])
    assert sum(isinstance(n,ast.For) for n in ast.walk(added))==1
    assert not any(isinstance(n,(ast.While,ast.Import,ast.ImportFrom,ast.With,ast.Try)) for n in ast.walk(added))
    calls=[ast.unparse(n.func) for n in ast.walk(added) if isinstance(n,ast.Call)]
    assert set(calls)=={'require'},calls
    # AST of all parser/schema/import code identical after exact delta removal.
    assert ast.dump(ast.parse(reconstructed))==ast.dump(ast.parse(old))
    with (ROOT/'delta.diff').open('x') as f: f.writelines(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile=str(OLD),tofile=str(NEW)))
    save('audit.json',{'before':before,'exact_reconstruction':True,'remaining_ast_identical':True,'imports':imports,'preflight_for_loops':1,'preflight_calls':calls,'before_json_loads':stop<new.index('return json.loads'),'source_sizes':[OLD.stat().st_size,NEW.stat().st_size]})
    env={'HOME':str(ROOT/'home'),'TMPDIR':str(ROOT/'tmp'),'PATH':'/usr/bin:/bin','LANG':'C','LC_ALL':'C','PYTHONDONTWRITEBYTECODE':'1'}
    runs=[]
    for label,exe in [('py39','/usr/bin/python3'),('py314','/Users/dane/.pyenv/versions/3.14.7/bin/python3')]:
        cmd=[exe,'-I','-B',str(ROOT/'main.py'),'worker']; started=time.monotonic()
        with (ROOT/(label+'.stdout')).open('xb') as out,(ROOT/(label+'.stderr')).open('xb') as err:
            try: p=subprocess.run(cmd,cwd=str(ROOT),env=env,stdout=out,stderr=err,timeout=20); code=p.returncode
            except subprocess.TimeoutExpired: code=124
        runs.append({'cmd':cmd,'cwd':str(ROOT),'exit':code,'seconds':time.monotonic()-started})
    after=[sha(OLD),sha(NEW)]; assert after==before
    sizes={p.name:p.stat().st_size for p in ROOT.rglob('*') if p.is_file()}
    assert sum(sizes.values())<4*1024*1024
    assert not list(ROOT.rglob('*.pyc'))
    assert all((ROOT/(label+ext)).stat().st_size<=1048576 for label in ['py39','py314'] for ext in ['.stdout','.stderr'])
    summary={'before':before,'after':after,'runs':runs,'env':env,'artifact_bytes':sum(sizes.values()),'files':sizes,'child_cpu_seconds':resource.getrusage(resource.RUSAGE_CHILDREN).ru_utime+resource.getrusage(resource.RUSAGE_CHILDREN).ru_stime,'limits':{'wall':90,'main_cpu':6,'each_child_cpu':12,'child_wall':20,'stream':1048576,'evidence':4194304},'scope':'own pure consumer only; no network/Node/official/model; interpreter binary under user installation only, HOME isolated'}
    save('summary.json',summary)
    print(json.dumps(summary))
    return 0 if all(r['exit']==0 for r in runs) else 1
if __name__=='__main__': sys.exit(worker() if len(sys.argv)>1 and sys.argv[1]=='worker' else main())
