"""Read-only normal CLI metadata projection; no prompt or credential storage reads."""
import importlib.util,json,pathlib,re,tempfile
root=pathlib.Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('smoke',root/'official-sonnet-01.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
MODEL='claude-sonnet-5.5'
fields={
 'thinkingToggleable':('thinkingToggleable','thinking_toggleable'),
 'defaultThinkingEnabled':('defaultThinkingEnabled','default_thinking_enabled'),
 'effortSchemaPath':('effortSchemaPath','effort_schema_path'),
 'effortLevels':('effortLevels','effort_levels'),
 'defaultEffortLevel':('defaultEffortLevel','default_effort_level'),
}
levels=['none','minimal','low','medium','high','xhigh','max']
def project(value):
 report={'exactSonnet55Present':False,'matchingObjects':0,'metadata':[],'truncated':False};visited=0
 def inspect(obj):
  entry={'present':{}}
  for name,aliases in fields.items():
   keys=[k for k in aliases if k in obj];entry['present'][name]=bool(keys)
   if not keys:continue
   v=obj[keys[0]]
   if name in ('thinkingToggleable','defaultThinkingEnabled'):entry[name]=v if type(v) is bool else 'other'
   elif name=='effortSchemaPath':entry[name]=v if v in ('output_config','reasoning') else 'other'
   elif name=='defaultEffortLevel':entry[name]=v if isinstance(v,str) and v in levels else 'other'
   else:entry[name]=[x if isinstance(x,str) and x in levels else 'other' for x in v[:32]] if isinstance(v,list) else 'other'
  report['matchingObjects']+=1
  if len(report['metadata'])<16:report['metadata'].append(entry)
 def walk(obj,depth=0,key=None):
  nonlocal visited
  visited+=1
  if visited>10000 or depth>12:report['truncated']=True;return
  if isinstance(obj,dict):
   match=key==MODEL or any(obj.get(k)==MODEL for k in ('id','modelId','model_id'))
   if match:report['exactSonnet55Present']=True;inspect(obj)
   for k,v in obj.items():walk(v,depth+1,k)
  elif isinstance(obj,list):
   for v in obj:walk(v,depth+1)
  elif obj==MODEL:report['exactSonnet55Present']=True
 walk(value)
 return report
# Pure projection gate: unknown fields/values and unrelated model metadata never escape.
fixture=project({'models':[{'id':MODEL,'thinkingToggleable':True,'defaultEffortLevel':'PRIVATE','effortLevels':['low','PRIVATE'],'secret':'PRIVATE'},{'id':'other','effortLevels':['high']}]})
assert fixture['matchingObjects']==1 and fixture['metadata'][0]['thinkingToggleable'] is True and 'PRIVATE' not in json.dumps(fixture)
with (root/'official-model-metadata-01.claim').open('x') as f:f.write('consumed\n')
rpt={'case':'official-model-metadata-01','inferencePromptSent':False,'projectionSelftestPassed':True}
try:
 with tempfile.TemporaryDirectory(prefix='kiro-model-metadata-01-') as cwd:
  result,buffers=m.run([m.CLI,'chat','--v3','--list-models','--format','json'],cwd,seconds=20)
  rpt['catalog']=result
  if result['exitCode']==0 and not result['failure'] and result['groupClear']:
   clean=re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',buffers['out'].decode('utf-8',errors='strict'))
   rpt['projection']=project(json.loads(clean))
 rpt['temporaryDirectoryRemoved']=not pathlib.Path(cwd).exists()
except (UnicodeDecodeError,json.JSONDecodeError):rpt['failure']='INVALID_JSON'
except Exception:rpt['failure']='LOCAL_OBSERVER_ERROR'
with (root/'official-model-metadata-01.json').open('x') as f:json.dump(rpt,f,indent=2);f.write('\n')
print(json.dumps(rpt))
