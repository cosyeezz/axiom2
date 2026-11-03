"""One normal CLI catalogue read (20s / 128KiB), no prompt or login change.
Current Google session only; never used as enterprise identity or inference proof.
Raw output remains in RAM. Any outcome consumes this metadata-only claim.
"""
import importlib.util,json,pathlib,tempfile
root=pathlib.Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('smoke',root/'official-sonnet-01.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
with (root/'official-model-list-01.claim').open('x') as f:f.write('consumed\n')
with tempfile.TemporaryDirectory(prefix='kiro-model-list-01-') as cwd:
 r,b=m.run([m.CLI,'chat','--v3','--list-models','--format','json'],cwd,seconds=20)
 r['command']='chat --v3 --list-models --format json';r['inferencePromptSent']=False
 known={'claude-sonnet-5.5','claude-opus-5.5','deepseek-3.2','claude-sonnet-4.5','claude-sonnet-4.6','claude-opus-4.6','claude-sonnet-4.7','claude-opus-4.7'}
 values=set();r['jsonValid']=False
 try:
  v=json.loads(b['out']);r['jsonValid']=True;r['rootType']=type(v).__name__
  if isinstance(v,list):r['rootItems']=len(v)
  def walk(x):
   if isinstance(x,dict):
    for a in x.values():walk(a)
   elif isinstance(x,list):
    for a in x:walk(a)
   elif isinstance(x,str) and x in known:values.add(x)
  walk(v)
 except Exception:pass
 r['knownModelIdsFound']=sorted(values)
r['temporaryDirectoryRemoved']=not pathlib.Path(cwd).exists()
with (root/'official-model-list-01.json').open('x') as f:json.dump(r,f,indent=2);f.write('\n')
print(json.dumps(r))
