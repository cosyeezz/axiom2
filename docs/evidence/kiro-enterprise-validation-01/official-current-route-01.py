"""Read normal existing KAS logs newer than the pre-login smoke, no CLI/model request.
Only fixed info-message technical fields persist; all contexts, IDs, profiles, headers,
credentials, unknown messages and complete experiment strings remain RAM/discarded.
<=8 files, <=8MiB each, <=16MiB total; no changed verbosity or proxy/TLS configuration.
"""
import collections,datetime,json,pathlib,re
root=pathlib.Path(__file__).resolve().parent
cut=datetime.datetime.fromtimestamp((root/'official-sonnet-02.json').stat().st_mtime,datetime.timezone.utc).strftime('%Y%m%dT%H%M%S')
logs=pathlib.Path.home()/'.kiro/logs'
r={'case':'official-current-route-01','modelInvocations':0,'filesRead':0,'limitsHit':False,'dispatches':[],'responsesRequests':[],'uaGates':[],'experimentSelections':[],'readinessCounts':{}}
fixed={'q.converse.dispatch','q.create_response.request','userAgent.gate.decided','[KiroAgent] Active experiments changed','experiment.readiness.deadline','experiment.readiness.unavailable'}
def objects(v):
 if isinstance(v,dict):
  yield v
  for x in v.values():yield from objects(x)
 elif isinstance(v,list):
  for x in v:yield from objects(x)
def strings(v):
 if isinstance(v,str):yield v
 elif isinstance(v,dict):
  for x in v.values():yield from strings(x)
 elif isinstance(v,list):
  for x in v:yield from strings(x)
def fields(v):
 out={}
 for obj in objects(v):
  for key in ('api','modelId','model','streaming','origin','enabled','customUserAgent','activeExperiments','endpoint'):
   if key in obj:out[key]=obj[key]
 return out
try:
 files=[p for p in logs.glob('*/kiro.log') if re.fullmatch(r'\d{8}T\d{9}',p.parent.name) and p.parent.name[:15]>cut]
 r['candidateFiles']=len(files);r['knownMarkerCounts']={k:0 for k in fixed}
 if len(files)>8:r['limitsHit']=True;files=[]
 total=0
 for path in sorted(files):
  size=path.stat().st_size
  if size>8*1024*1024 or total+size>16*1024*1024:r['limitsHit']=True;continue
  total+=size;raw=path.read_bytes();r['filesRead']+=1
  for marker in fixed:r['knownMarkerCounts'][marker]+=raw.count(marker.encode())
  for line in raw.splitlines():
   if len(line)>262144:r['limitsHit']=True;continue
   try:v=json.loads(line)
   except Exception:continue
   text='\n'.join(strings(v))
   msgs={message for message in fixed if message in text}
   if not msgs:continue
   d=fields(v)
   # Official logger may format metadata into message via util.inspect instead of JSON fields.
   for key,values in {'api':['CreateResponse','GenerateAssistantResponse'],'modelId':['claude-sonnet-5.5'],'model':['claude-sonnet-5.5'],'origin':['KIRO_CLI']}.items():
    for value in values:
     if re.search(r'''(?:["']?\b'''+re.escape(key)+r'''["']?)\s*[:=]\s*["']'''+re.escape(value)+r'''["']''',text):d[key]=value
   for key in ('streaming','enabled'):
    match=re.search(r'''["']?\b'''+key+r'''["']?\s*[:=]\s*(true|false)\b''',text)
    if match:d[key]=match.group(1)=='true'
   if 'endpoint' not in d:
    match=re.search(r'''["']?\bendpoint["']?\s*[:=]\s*["'](https://[^"'\s]+)["']''',text)
    if match:d['endpoint']=match.group(1)
   if 'activeExperiments' not in d:d['activeExperiments']=text
   if 'q.converse.dispatch' in msgs:
    r['dispatches'].append({'api':d.get('api') if d.get('api') in ('CreateResponse','GenerateAssistantResponse') else 'other','exactSonnet55':d.get('modelId')=='claude-sonnet-5.5','streaming':d.get('streaming') if isinstance(d.get('streaming'),bool) else None,'originKiroCli':d.get('origin')=='KIRO_CLI'})
   if 'q.create_response.request' in msgs:
    endpoint=d.get('endpoint');known=bool(isinstance(endpoint,str) and re.match(r'^https://runtime\.[a-z0-9-]+\.kiro\.dev(?:/|$)',endpoint))
    r['responsesRequests'].append({'exactSonnet55':d.get('model')=='claude-sonnet-5.5','officialRuntimeEndpoint':known,'originKiroCli':d.get('origin')=='KIRO_CLI'})
   if 'userAgent.gate.decided' in msgs:
    ua=d.get('customUserAgent');r['uaGates'].append({'enabled':d.get('enabled') if isinstance(d.get('enabled'),bool) else None,'kiroCliMarker':isinstance(ua,str) and ('KiroCLI' in ua or 'kiro-cli' in ua),'kiroVersion237Marker':isinstance(ua,str) and '2.37.0' in ua})
   if '[KiroAgent] Active experiments changed' in msgs:
    e=d.get('activeExperiments');e=e if isinstance(e,str) else ''
    r['experimentSelections'].append({'createResponseSelectionMentioned':bool(re.search(r'create_response_api.{0,5}create_response\b',e)),'disabledSelectionMentioned':bool(re.search(r'create_response_api.{0,5}disabled\b',e))})
   for msg in msgs&{'experiment.readiness.deadline','experiment.readiness.unavailable'}:r['readinessCounts'][msg]=r['readinessCounts'].get(msg,0)+1
 r['readCompleted']=True
except Exception as e:r['failureType']=type(e).__name__
with (root/'official-current-route-01-fields.json').open('x') as f:json.dump(r,f,indent=2);f.write('\n')
print(json.dumps(r))
