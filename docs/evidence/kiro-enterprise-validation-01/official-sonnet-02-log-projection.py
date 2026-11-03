"""Read existing KAS logs only; no CLI/network invocation or credential storage access."""
import collections, datetime, json, pathlib, re
root=pathlib.Path(__file__).resolve().parent
lo=(root/'official-sonnet-02.claim').stat().st_mtime-2
hi=(root/'official-sonnet-02.json').stat().st_mtime+2
logs=pathlib.Path.home()/'.kiro/logs'
out={'case':'official-sonnet-02','candidateFiles':0,'correlatedFiles':0,'records':0,'statusCounts':{},'knownCodes':{},'knownFaultKinds':{},'errorRecords':0,'predicates':{},'limitsHit':False,'noModelInvocation':True,'requestedModelRejected':False,'rejectedMethods':[]}
codes={'AccessDeniedException','ValidationException','UnauthorizedException','NotAuthorizedException','InvalidSignatureException','UnrecognizedClientException','ExpiredTokenException','TooManyRequestsException','ResourceNotFoundException','ModelNotReadyException','ServiceQuotaExceededException','ModelErrorException','ThrottlingException','InternalServerException','ServiceUnavailableException'}
faults={'aborted','network','http','serviceRejection','undecodable','protocol','unknown','relayedFrame','sandboxError'}
patterns={'requiresModelOptIn':'kiro:model_requires_user_opt_in','accessDenied':'AccessDeniedException','notAuthorizedModel':'not authorized to access this model','modelNotFound':'model not found','notAvailableModel':'model is not available','invalidModel':'invalid model','unsupportedModel':'unsupported model','quota':'quota','rateLimit':'rate limit','expiredToken':'token has expired','loginRequired':'please log in','timedOut':'timed out','connectionRefused':'ECONNREFUSED','modelIdNotAvailable':'claude-sonnet-5.5 is not available','modelIdUnsupported':'claude-sonnet-5.5 is not supported'}
counts=collections.Counter();codecounts=collections.Counter();faultcounts=collections.Counter();pred=collections.Counter();total=0
try:
 candidates=[p for p in logs.glob('*/kiro.log') if lo<=p.stat().st_mtime<=hi]
 out['candidateFiles']=len(candidates)
 if len(candidates)>8:out['limitsHit']=True;candidates=[]
 for p in candidates:
  size=p.stat().st_size
  if size>8*1024*1024 or total+size>16*1024*1024:out['limitsHit']=True;continue
  raw=p.read_bytes();total+=len(raw)
  if b'axiom-official-sonnet-02' not in raw and b'kiro-sonnet-02-' not in raw:continue
  out['correlatedFiles']+=1
  for line in raw.splitlines():
   if len(line)>256*1024:out['limitsHit']=True;continue
   try:v=json.loads(line)
   except Exception:continue
   stamp=v.get('timestamp')
   try:t=datetime.datetime.fromisoformat(stamp.replace('Z','+00:00')).timestamp()
   except Exception:continue
   if not lo<=t<=hi:continue
   out['records']+=1
   error_record=v.get('level') in ('error','ERROR','warn','WARN',40,50)
   if error_record:
    out['errorRecords']+=1
    low=line.lower()
    if b'claude-sonnet-5.5' in low and (b'invalid model' in low or b'model is not available' in low):out['requestedModelRejected']=True
   def walk(x):
    if isinstance(x,dict):
     for k,a in x.items():
      if error_record and k=='method' and a in ('session/prompt','session/set_model','session/set_config_option','session/new') and a not in out['rejectedMethods']:out['rejectedMethods'].append(a)
      if k in ('httpStatus','httpStatusCode','statusCode') and isinstance(a,int) and not isinstance(a,bool) and 100<=a<=599:counts[str(a)]+=1
      if k in ('errorName','name','code') and isinstance(a,str) and a in codes:codecounts[a]+=1
      if k=='faultKind' and isinstance(a,str) and a in faults:faultcounts[a]+=1
      walk(a)
    elif isinstance(x,list):
     for a in x:walk(a)
    elif isinstance(x,str) and error_record:
     for k,needle in patterns.items():
      if needle.lower() in x.lower():pred[k]+=1
   walk(v)
 out['statusCounts']=dict(counts);out['knownCodes']=dict(codecounts);out['knownFaultKinds']=dict(faultcounts);out['predicates']={k:pred[k]>0 for k in patterns}
 out['readCompleted']=True
except Exception:out['readCompleted']=False;out['failure']='LOCAL_OR_SCHEMA'
with (root/'official-sonnet-02-log-classification.json').open('x') as f:json.dump(out,f,indent=2);f.write('\n')
print(json.dumps(out))
