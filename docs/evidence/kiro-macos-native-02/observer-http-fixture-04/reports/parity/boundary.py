import sys
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
