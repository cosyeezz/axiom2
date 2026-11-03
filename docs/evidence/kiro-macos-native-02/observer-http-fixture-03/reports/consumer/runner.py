import sys
sys.dont_write_bytecode = True
import os, json, hashlib, importlib.util, resource, copy, base64, ast, time
resource.setrlimit(resource.RLIMIT_CPU, (8, 8))
resource.setrlimit(resource.RLIMIT_FSIZE, (1048576,1048576))
root=sys.argv[1]
source='/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02/observer-http-fixture-02/terminal_consumer.py'
source_bytes=open(source,'rb').read()
sha=hashlib.sha256(source_bytes).hexdigest()
assert sha=='0a4871784b92e07baa43f9ad2395e95d6ac0b5250ec390e548f05a9b61193bdf'
spec=importlib.util.spec_from_file_location('consumer_under_test',source)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
# Static import surface and dynamic audit are complementary; not an OS sandbox.
tree=ast.parse(source_bytes)
imports=[n.names[0].name for n in tree.body if isinstance(n,ast.Import)]
assert imports==['base64','json']
active=False; audit_violations=[]
def audit(event,args):
    if active and (event=='open' or event.startswith(('socket.','subprocess.','os.system','os.exec','os.spawn','ctypes.'))):
        audit_violations.append(event)
        raise RuntimeError('pure validation attempted I/O: '+event)
sys.addaudithook(audit)
results=[]
def run(name,fn,valid=False):
    global active
    active=True
    try:
        answer=fn()
    except ValueError as e:
        results.append({'name':name,'pass':not valid,'outcome':'ValueError','reason':str(e)[:160]})
    except BaseException as e:
        results.append({'name':name,'pass':False,'outcome':'UNEXPECTED '+type(e).__name__,'reason':str(e)[:160]})
    else:
        results.append({'name':name,'pass':valid,'outcome':'accepted'})
    finally: active=False

def enc(x):return json.dumps(x,separators=(',',':'),ensure_ascii=True).encode()
def end():return dict(kind='end',id=1,originalReturned=True,returnType='object',returnIsThis=True,booleanReturn=None,bytes=0,bodyBase64='')
E=[dict(kind='request',id=1,method='POST',path='/fake'),dict(kind='header-cache',id=1,value='POST /fake HTTP/1.1\r\n\r\n'),end()]
def pack(events,body=0):
    t=b''.join(enc(e)+b'\n' for e in events)
    s=dict(ok=True,reason=None,events=len(events),bodyBytes=body,logBytes=len(t),requests=1,pendingBodyBytes=0)
    return s,t
S,T=pack(E)
def check(s,t,scope=m.SCOPE,n=1):return m.validate_capture(enc(s) if not isinstance(s,bytes) else s,t,scope=scope,expected_requests=n)
def evcase(name,index,key,value=None,delete=False):
    e=copy.deepcopy(E)
    if delete:del e[index][key]
    else:e[index][key]=value
    s,t=pack(e);run(name,lambda:check(s,t))
def seqcase(name,e,body=0):
    s,t=pack(e,body);run(name,lambda:check(s,t))
# Frozen old artifact consumed once per interpreter, not replayed HTTP/pure calibration.
old_s=open(root+'/snapshot.status.json','rb').read();old_t=open(root+'/snapshot.ndjson','rb').read()
run('existing02_expected10',lambda:m.validate_capture(old_s,old_t,scope=m.SCOPE,expected_requests=10),True)
run('minimal_complete',lambda:check(S,T),True)
for name,raw in [('dup',b'{"a":1,"a":2}'),('escaped_dup',b'{"a":1,"\\u0061":2}'),('nan',b'NaN'),('inf',b'Infinity'),('neginf',b'-Infinity'),('float',b'1.0'),('exponent',b'1e0'),('giantint',b'1'*10000),('utf8',b'"\xff"'),('depth',b'['*2000+b'0'+b']'*2000),('empty',b''),('text_type','{}'),('bytearray',bytearray(b'{}')),('json_tail',b'{}x')]:
    run('json_'+name,lambda raw=raw:m.strict_json(raw,20000))
run('json_cap',lambda:m.strict_json(b'{}',1))
for name,raw in [('dup',b'{"ok":true,"ok":true,'+enc(S)[1:]),('escaped_dup',b'{"\\u006fk":true,'+enc(S)[1:]),('wrong_schema',b'[]'),('utf8',b'"\xff"'),('depth',b'['*2000+b'0'+b']'*2000),('cap',b' '*2049)]:
    run('status_'+name,lambda raw=raw:check(raw,T))
for field in S:
    for label,value in [('null',None),('string','1'),('array',[]),('object',{}),('float',1.0)]:
        if field=='reason' and value is None:continue
        s=dict(S);s[field]=value;run('status_'+field+'_'+label,lambda s=s:check(s,T))
    s=dict(S);del s[field];run('status_missing_'+field,lambda s=s:check(s,T))
for field,cap in [('events',128),('bodyBytes',262144),('logBytes',1048576),('requests',128),('pendingBodyBytes',262144)]:
    for label,value in [('bool',True),('negative',-1),('overcap',cap+1),('counter_mismatch',1 if S[field]!=1 else 2),('giant20',99999999999999999999)]:
        if field=='reason' and value is None:continue
        s=dict(S);s[field]=value;run('status_'+field+'_'+label,lambda s=s:check(s,T))
s=dict(S,extra=0);run('status_extra',lambda:check(s,T))
for label,value in [('false',False),('int',1)]:
    s=dict(S,ok=value);run('status_ok_'+label,lambda s=s:check(s,T))
for n in [0,-1,True,1.0,129,'1',None,2]:run('expected_'+repr(n),lambda n=n:check(S,T,n=n))
run('wrong_scope',lambda:check(S,T,scope='other'))
for name,t in [('unterminated',T[:-1]),('empty',b''),('str',T.decode()),('bytearray',bytearray(T)),('overcap',b'x'*1048577),('blank_line',T+b'\n'),('trailing_partial',T+b'{')]:run('trace_'+name,lambda t=t:check(S,t))
for name,line in [('dup',b'{"kind":"request","kind":"request","id":1,"method":"POST","path":"/fake"}'),('escaped_dup',b'{"kind":"request","\\u006bind":"request","id":1,"method":"POST","path":"/fake"}'),('utf8',b'{"kind":"\xff"}'),('depth',b'['*2000+b'0'+b']'*2000),('float',b'{"kind":"request","id":1.0,"method":"POST","path":"/fake"}'),('nonfinite',b'{"kind":"request","id":NaN,"method":"POST","path":"/fake"}'),('giantint',b'{"kind":"request","id":'+b'1'*100+b',"method":"POST","path":"/fake"}'),('array',b'[]')]:
    t=line+b'\n'+b'\n'.join(T.split(b'\n')[1:]);s=dict(S,logBytes=len(t));run('event_'+name,lambda s=s,t=t:check(s,t))
for idx,event in enumerate(E):
    for key in event:
        evcase('event%d_missing_%s'%(idx,key),idx,key,delete=True)
    evcase('event%d_extra'%idx,idx,'extra',0)
for key in ['id','method','path']:
    for v in [None,True,[],{},1.0]:evcase('request_'+key+'_'+repr(v),0,key,v)
for v in [0,2,129,-1]:evcase('request_id_'+str(v),0,'id',v)
for v in [None,False,1,[],{},'unknown']:evcase('kind_'+repr(v),0,'kind',v)
for idx in [1,2]:
    for v in [True,0,2,129,-1,None,1.0]:evcase('reference%d_%s'%(idx,repr(v)),idx,'id',v)
for v in [None,False,1,[],{},'', 'POST /fake\r\n'] :evcase('header_'+repr(v),1,'value',v)
seqcase('duplicate_header',E[:2]+[copy.deepcopy(E[1]),end()])
seqcase('missing_header',[E[0],end()])
seqcase('missing_end',E[:2])
seqcase('duplicate_end',E+[end()])
seqcase('end_before_registration',[end()]+E)
seqcase('duplicate_request',[E[0],E[0]]+E[1:])
seqcase('request_id_gap',[dict(E[0],id=2)]+E[1:])
s,t=pack([]);s['requests']=0;run('empty_requestset',lambda:check(s,t))
seqcase('only_failed_request',[dict(kind='request-call',api='http.request',originalReturned=False)])
for v in [None,0,1,'true',[],{}]:evcase('return_discriminator_'+repr(v),2,'originalReturned',v)
for key in ['returnType','returnIsThis','booleanReturn','bytes','bodyBase64']:
    for v in [None,True,False,0,1,1.0,[],{}]:
        if (key=='returnIsThis' and v is True) or (key=='booleanReturn' and v is None) or (key=='bytes' and type(v) is int and v==0):continue
        evcase('end_'+key+'_'+repr(v),2,key,v)
for v in ['A===','Zg=','Zg===','Zh==','Zg==\n','Z g==','!!!!','é','Zg==','Zm8=']:
    evcase('base64_'+repr(v),2,'bodyBase64',v)
evcase('bytes_negative',2,'bytes',-1);evcase('bytes_cap',2,'bytes',262145)
# Noncanonical pad bits must reject even when decoded byte count matches.
e=copy.deepcopy(E);e[2].update(bytes=1,bodyBase64='Zh==');seqcase('base64_padbits_matchedbytes',e,1)
e=copy.deepcopy(E);e[2].update(bytes=1,bodyBase64='Zg==');seqcase('canonical_bytes_counter_mismatch',e)
s,t=pack(e,1);run('canonical_body_valid',lambda:check(s,t),True)
for kind in ['request-call','header-call']:
    for returned in [None,0,1,'true']:
        evt=dict(kind=kind,originalReturned=returned)
        if kind=='request-call':evt['api']='http.request'
        seqcase(kind+'_discriminator_'+repr(returned),E+[evt])
for evt in [dict(kind='request-call',api='bad',originalReturned=False),dict(kind='request-call',api=[],originalReturned=False),dict(kind='request-call',api='http.request',originalReturned=True),dict(kind='request-call',api='http.request',originalReturned=False,id=1),dict(kind='header-call',originalReturned=True),dict(kind='header-call',originalReturned=False,extra=1),dict(kind='write',id=1,originalReturned=False,bytes=0),dict(kind='end',id=1,originalReturned=False,bodyBase64='')]:seqcase('return_schema_'+str(len(results)),E+[evt])
write=dict(end(),kind='write',returnType='boolean',returnIsThis=False,booleanReturn=True)
for key,v in [('returnType','object'),('returnIsThis',True),('booleanReturn',None),('booleanReturn',1)]:
    w=dict(write);w[key]=v;seqcase('write_schema_'+key+'_'+repr(v),E[:2]+[w,end()])
s,t=pack(E[:2]+[write,end()]);run('write_bool_valid',lambda:check(s,t),True)
# Individually valid chunks whose aggregate crosses MAX_BODY.
w=dict(write,bytes=131073,bodyBase64=base64.b64encode(b'x'*131073).decode())
e=E[:2]+[w,w,end()];s,t=pack(e,262144);run('aggregate_body_cap',lambda:check(s,t))
# Count cap and mismatches independent of default fixture.
e=E[:2]+[dict(kind='header-call',originalReturned=False)]*126+[end()];s,t=pack(e);run('event_count_cap',lambda:check(s,t))
assert not audit_violations
post=hashlib.sha256(open(source,'rb').read()).hexdigest()
assert post==sha
report=dict(python=sys.version,executable=sys.executable,source_sha_before=sha,source_sha_after=post,static_imports=imports,audit_violations=audit_violations,cases=results,total=len(results),passed=sum(r['pass'] for r in results),failed=sum(not r['pass'] for r in results),cpu_seconds=time.process_time(),sandbox=False)
print(json.dumps(report,ensure_ascii=True,indent=2))
sys.exit(1 if report['failed'] else 0)
