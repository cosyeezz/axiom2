#!/usr/bin/env python3
from pathlib import Path
import json,hashlib,re,difflib,sys
ROOT=Path('/Volumes/D_Work/axiom2');OUT=Path('/tmp/axiom-runtime-final-recheck');OLD=Path('/tmp/axiom-runtime-snapshot-64c5a847');E=ROOT/'docs/evidence/agent-runtime-capabilities'
checks=[]
def check(name,a,b=True):checks.append(dict(name=name,ok=a==b,actual=a,expected=b))
def load(p):return json.loads(p.read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
inv=load(E/'pi-coupling-inventory.json');s=inv['summary'];old=load(OLD/'docs/evidence/agent-runtime-capabilities/pi-coupling-inventory.json')
check('new expected manifest',s['sourceManifestHash'],'9f42b477d57636707e0e1d2a078fee8f33357a1504d89e4f7931f8e80043dd78')
check('explicit total LOC',s['codeLines'],64447)
check('explicit area files/LOC',{k:[s['scopeCounts'][k]['codeFiles'],s['scopeCounts'][k]['lines']] for k in ['server','client','shared']},{'server':[269,36984],'client':[259,22554],'shared':[72,4909]})
check('structural figures',[s[k] for k in ['coupledFiles','moduleSites','importedBindings','uniquePackageSymbols']],[94,127,277,100])
oldfiles={f['path']:f for f in old['files']};newfiles={f['path']:f for f in inv['files']}
check('snapshot file membership unchanged',sorted(newfiles),sorted(oldfiles))
changed=[f for f in oldfiles if oldfiles[f]!=newfiles[f]]
check('snapshot delta only reviewed external file',changed,['app/src/server/usage-materialized-store.ts'])
for key in ['fileModes','sites','bindings','localEdges','unresolvedLocalEdges','parseDiagnostics','piReachableFiles']:check('snapshot '+key+' unchanged',inv[key],old[key])
for name in ['scan-pi-coupling.mjs','render-capability-inventory.mjs','capability-matrix.json']:check(name+' unchanged from backed-up snapshot',sha(E/name),sha(OLD/'docs/evidence/agent-runtime-capabilities'/name))
contract=ROOT/'docs/agent-runtime-adapter-contract.md';before=(OLD/'docs/agent-runtime-adapter-contract.md').read_text();after=contract.read_text();ts=lambda x:re.findall(r'^```(?:ts|typescript)\s*\n(.*?)^```\s*$',x,re.M|re.S)
check('contract contains TS code fences',len(ts(after))>0)
check('contract TypeScript code fences byte-identical',ts(after),ts(before))
(OUT/'contract-prose.diff').write_text(''.join(difflib.unified_diff(before.splitlines(True),after.splitlines(True),fromfile='64c5 contract',tofile='9f42 contract')))
main=(ROOT/'docs/agent-runtime-capability-inventory.md').read_text()
check('main explicit area LOC and file counts',all(x in main for x in ['server 269、client 259、shared 72','64,447','server 36,984、client 22,554、shared 4,909']))
check('main old hash no longer claimed','64c5a847b82947b8188deadf4b72be959e2af2853d196e4135b673964eb3da14' not in main)
failed=[x['name'] for x in checks if not x['ok']];(OUT/'supplement-results.json').write_text(json.dumps(dict(checks=checks,failed=failed),ensure_ascii=False,indent=2)+'\n')
print(json.dumps(dict(checkCount=len(checks),failed=failed,changedSnapshotFiles=changed,contractTSFences=len(ts(after))),ensure_ascii=False,indent=2));sys.exit(bool(failed))
