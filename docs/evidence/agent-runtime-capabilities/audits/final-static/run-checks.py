#!/usr/bin/env python3
# Reproduction helper: read-only repository; isolated /tmp output. Does NOT run product tests.
from pathlib import Path
import subprocess,json
out=Path('/tmp/axiom-runtime-final-static/recheck');out.mkdir(parents=True,exist_ok=True)
root='/Volumes/D_Work/axiom2'
commands=[['node','--check','docs/evidence/agent-runtime-capabilities/scan-pi-coupling.mjs'],['node','--check','docs/evidence/agent-runtime-capabilities/render-capability-inventory.mjs'],['node','docs/evidence/agent-runtime-capabilities/render-capability-inventory.mjs',str(out/'rendered')],['python3','/tmp/axiom-runtime-final-static/verify.py']]
records=[]
for i,c in enumerate(commands,1):
 p=subprocess.run(c,cwd=root,capture_output=True,text=True)
 (out/f'{i:02d}.stdout.log').write_text(p.stdout);(out/f'{i:02d}.stderr.log').write_text(p.stderr);(out/f'{i:02d}.exit').write_text(str(p.returncode)+'\n')
 records.append(dict(command=c,exit=p.returncode))
(out/'commands.json').write_text(json.dumps(records,indent=2)+'\n')
print(json.dumps(records,indent=2))
# verify.py uses its fixed /tmp root for results.json; no repository writes.
