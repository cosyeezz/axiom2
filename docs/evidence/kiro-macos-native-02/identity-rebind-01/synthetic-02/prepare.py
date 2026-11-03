import ast, hashlib, json, sys
from pathlib import Path
root=Path(sys.argv[1])
base=Path('/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02/identity-rebind-01')
old=(base/'synthetic-01/source-under-test.py').read_bytes()
current=(base/'rebind_identity.py').read_bytes()
a=ast.parse(old);b=ast.parse(current)
assert hashlib.sha256(old).hexdigest()=='c2a8be25a88b0aa474d0c83bfa144e8fa348fc76db5670592795281d01bd8148'
assert len(a.body)==len(b.body)
different=[i for i,(x,y) in enumerate(zip(a.body,b.body)) if ast.dump(x,include_attributes=False)!=ast.dump(y,include_attributes=False)]
assert len(different)==1,different
i=different[0]; prev=a.body[i];now=b.body[i]
assert isinstance(prev,ast.FunctionDef) and prev.name==now.name=='open_regular'
expected=ast.parse('''def open_regular(path, cap):
    fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
    try:
        s = os.fstat(fd)
        check(stat.S_ISREG(s.st_mode) and 0 < s.st_size <= cap, 'input-type-or-cap')
        check(identity(s) == identity(os.stat(path, follow_symlinks=False)), 'input-path-race')
        return fd, s
    except BaseException:
        os.close(fd)
        raise
''').body[0]
assert ast.dump(now,include_attributes=False)==ast.dump(expected,include_attributes=False)
assert ast.dump(prev.body[0],include_attributes=False)==ast.dump(now.body[0],include_attributes=False)
assert [ast.dump(x,include_attributes=False) for x in prev.body[1:]]==[ast.dump(x,include_attributes=False) for x in now.body[1].body]
(root/'source-under-test.py').write_bytes(current)
report={'status':'passed','changedTopLevelNodes':['open_regular'],'exactExpectedCleanupAST':True,'otherTopLevelNodesUnchanged':True,'oldSourceSha256':hashlib.sha256(old).hexdigest(),'sourceSha256':hashlib.sha256(current).hexdigest()}
(root/'ast-check.json').write_text(json.dumps(report,indent=2)+'\n')
oldtest=(base/'synthetic-01/test_synthetic.py').read_text()
addition='''def stat_race_no_leak():
    from types import SimpleNamespace
    p.write_bytes(base)
    before=fdset()
    real_stat=m.os.stat
    calls=[]
    def fake_stat(path,*args,**kwargs):
        result=real_stat(path,*args,**kwargs)
        if os.fspath(path)==os.fspath(p):
            calls.append((str(path),kwargs))
            return SimpleNamespace(st_dev=result.st_dev,st_ino=result.st_ino,st_size=result.st_size,st_mtime_ns=result.st_mtime_ns+1,st_ctime_ns=result.st_ctime_ns)
        return result
    try:
        m.os.stat=fake_stat
        try:
            rejects(lambda:m.open_regular(p,len(base)),'input-path-race')
        finally:
            m.os.stat=real_stat
        eq(len(calls),1)
        eq(calls[0][1],{'follow_symlinks':False})
        eq(fdset()-before,set())
    finally:
        m.os.stat=real_stat
        for fd in fdset()-before:os.close(fd)
test('open-reject-controlled-stat-path-race-no-fd-leak',stat_race_no_leak)
'''
assert oldtest.count("report={'source':")==1
newtest=oldtest.replace("report={'source':",addition+"report={'source':",1)
# All original 65 tests/oracles remain byte-identical; only insert one new test.
assert newtest.replace(addition,'',1)==oldtest
(root/'test_synthetic.py').write_text(newtest)
print(json.dumps(report))
