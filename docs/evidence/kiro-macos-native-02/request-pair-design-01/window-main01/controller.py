#!/usr/bin/env python3
import hashlib,json,os,re,resource,signal,subprocess,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parent
REPO=Path('/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02/request-pair-design-01')
NODE='/Users/dane/.local/share/pi-node/node-v22.23.2-darwin-arm64/bin/node'
IDS=['W01-cross-process-ready-order','W02-two-in-one-turn','W03-connection-failure','W04-owner-abort','W05-saved-wrapper-late','W06-close-conflict-last']
def save(name,value):
    with (ROOT/name).open('x') as f:json.dump(value,f,indent=2);f.write('\n')
def sources():
    m=json.loads((REPO/'WINDOW-SOURCE-BINDING.json').read_text())['files'];out={};n=0
    for name,expected in m.items():
        b=(REPO/name).read_bytes();n+=len(b);v={'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()};assert v==expected;out[name]=v
    assert n<=131072
    return {'files':out,'hashReadBytes':n}
def restrict():
    resource.setrlimit(resource.RLIMIT_CPU,(8,9));resource.setrlimit(resource.RLIMIT_CORE,(0,0));resource.setrlimit(resource.RLIMIT_NOFILE,(64,64));resource.setrlimit(resource.RLIMIT_FSIZE,(262144,262144))
def keys(x,names):assert type(x) is dict and set(x)==set(names.split())
def window(x):
    keys(x,'state fault windowClosed channelReady observedCandidates reservedFrames queuedFrames peakQueuedFrames nodeState nodeFault undiciState channelState channelFault')
    for name in ['windowClosed','channelReady']:assert type(x[name]) is bool
    for name in ['observedCandidates','reservedFrames','queuedFrames','peakQueuedFrames']:assert type(x[name]) is int and 0<=x[name]<=5
    enums={'window-closed','failed','none','candidate-count-or-state','channel-setup-fault','owner-aborted','observer-fault','closed','conflict','late-call','restore-conflict','missing'}
    for name in set(x)-{'windowClosed','channelReady','observedCandidates','reservedFrames','queuedFrames','peakQueuedFrames'}:assert x[name] in enums

def child(x):
    keys(x,'mode ok pid node platform arch undiciVersion earlyQueued readyBeforeHttp window')
    assert x['mode'] in ['node','undici'] and type(x['ok']) is bool and type(x['pid']) is int and x['pid']>0
    assert re.fullmatch(r'v\d+\.\d+\.\d+',x['node']) and x['platform']=='darwin' and x['arch']=='arm64'
    assert x['undiciVersion'] is None or re.fullmatch(r'\d+\.\d+\.\d+',x['undiciVersion'])
    assert type(x['earlyQueued']) is bool and type(x['readyBeforeHttp']) is bool
    window(x['window'])
def report(x):
    keys(x,'schema pid node platform arch results children httpRequests serverMatches port');assert x['schema']==1 and type(x['pid']) is int
    assert re.fullmatch(r'v\d+\.\d+\.\d+',x['node']) and x['platform']=='darwin' and x['arch']=='arm64'
    assert type(x['port']) is int and 0<x['port']<65536
    assert type(x['httpRequests']) is int and type(x['serverMatches']) is int and 0<=x['serverMatches']<=x['httpRequests']<=2
    assert len(x['children'])==2
    for c in x['children']:
        keys(c,'mode pid exit signal');assert c['mode'] in ['node','undici'] and type(c['pid']) is int and type(c['exit']) is int and c['signal'] is None
    assert len(x['results'])==6
    for i,c in enumerate(x['results']):
        keys(c,'id passed evidence');assert c['id']==IDS[i] and type(c['passed']) is bool;e=c['evidence']
        if not c['passed']:keys(e,'fault');assert e['fault']=='fixture-assertion-or-failure';continue
        if i==0:
            keys(e,'channelState bodiesEqual serverMatches records cleanup');assert e['channelState']=='candidate-pair' and e['bodiesEqual'] is True and e['serverMatches']==2
            assert len(e['records'])==2
            for r in e['records']:child(r)
            keys(e['cleanup'],'ownDirectoryRemoved');assert e['cleanup']['ownDirectoryRemoved'] is True
        elif i in [1,2]:
            keys(e,'originalCalls window');assert e['originalCalls']==(2 if i==1 else 1);window(e['window'])
        elif i==3:keys(e,'window');window(e['window'])
        elif i==4:
            keys(e,'originalCalls oldDoneFault oldDoneState live oldResultIsTerminal');assert e['originalCalls']==2 and e['oldDoneFault']=='none' and e['oldDoneState']=='window-closed' and e['oldResultIsTerminal'] is False;window(e['live'])
        else:
            keys(e,'originalCalls window newOwnerPreserved adapterOwnerClearedClaim');assert e['originalCalls']==1 and e['newOwnerPreserved'] is True and e['adapterOwnerClearedClaim'] is False;window(e['window'])
    return all(c['passed'] for c in x['results'])
def main():
    with (ROOT/'RUN.lock').open('x') as f:f.write('own-first-window-once\n')
    start=time.monotonic();out={'status':'failed','fault':'none','heldPID':None,'childExit':None,'timedOut':False,'reportValidated':False,'stdout':'DEVNULL','stderr':'DEVNULL','nativeEnvironmentAudited':False};p=None
    try:
        before=sources();save('source-before.json',before)
        env={'HOME':str(ROOT),'TMPDIR':str(ROOT),'PATH':'/usr/bin:/bin','LANG':'C','LC_ALL':'C'}
        argv=[NODE,str(ROOT/'harness.cjs')];save('command.json',{'argv':argv,'cwd':str(ROOT),'passedEnvKeys':list(env),'wallSeconds':12,'newOwnSession':True})
        node_start=time.monotonic();p=subprocess.Popen(argv,cwd=str(ROOT),env=env,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True,preexec_fn=restrict);out['heldPID']=p.pid
        try:out['childExit']=p.wait(timeout=12)
        except subprocess.TimeoutExpired:
            out['timedOut']=True;os.killpg(p.pid,signal.SIGKILL);out['childExit']=p.wait(timeout=2)
        out['nodeWallSeconds']=time.monotonic()-node_start
        after=sources();save('source-after.json',after);assert before==after
        b=(ROOT/'harness-result.json').read_bytes();assert len(b)<=32768;x=json.loads(b);passed=report(x);assert x['pid']==p.pid;out['reportValidated']=True
        for mode in ['node','undici']:
            b=(ROOT/(mode+'-result.json')).read_bytes();assert len(b)<=32768;c=json.loads(b);child(c)
            recorded=next(v for v in x['children'] if v['mode']==mode);assert c['pid']==recorded['pid'] and c['mode']==mode
        out['status']='passed' if not out['timedOut'] and out['childExit']==0 and passed else 'failed'
    except Exception:
        out['fault']='own-controller-or-validation-fault'
        if p is not None and p.poll() is None:
            try:os.killpg(p.pid,signal.SIGKILL);out['childExit']=p.wait(timeout=2)
            except Exception:out['cleanupUnknown']=True
    out['elapsedSeconds']=time.monotonic()-start
    save('controller-result.json',out);print(json.dumps({'status':out['status'],'heldPID':out['heldPID'],'childExit':out['childExit']}))
    return 0 if out['status']=='passed' else 1
if __name__=='__main__':raise SystemExit(main())
