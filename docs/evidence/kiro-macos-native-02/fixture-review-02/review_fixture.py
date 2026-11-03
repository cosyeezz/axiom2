#!/usr/bin/env python3
"""Correct one language-ID oracle; reuse frozen execution without rerunning it."""
import hashlib
import json
from pathlib import Path
import re
import time
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT.parent/'fixture-01'
OUT = ROOT/'verification.json'
if OUT.exists():
    raise SystemExit('CreateNew output gate')

def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()

r = json.loads((SOURCE/'verification.json').read_text())
f = json.loads((SOURCE/'focused.json').read_text())
ldefs = Path('/opt/homebrew/opt/ghidra/libexec/Ghidra/Processors/AARCH64/data/languages/AppleSilicon.ldefs')
lang = ET.parse(ldefs).getroot().find('language')
corrected_language = lang.attrib['id']
checks = dict(r['checks'])
assert {k for k,v in checks.items() if not v} == {'expectedLanguage'}, 'not just the documented oracle mismatch'
assert f['language'] == corrected_language == 'AARCH64:LE:64:AppleSilicon'
assert {k:lang.attrib[k] for k in ['processor','endian','size']} == {'processor':'AARCH64','endian':'little','size':'64'}
checks['expectedLanguage'] = True
start, end = int(f['entry'],16), int(f['endInclusive'],16)
checks['frozenSourcesStillMatch'] = all(sha(p)==h for p,h in r['sourceHashesBefore'].items())
checks['frozenBinaryStillMatches'] = sha(r['binary']['path']) == r['binary']['sha256']
checks['exactly31FourByteInstructions'] = len(f['instructions']) == 31 and all(len(bytes.fromhex(i['bytes']))==4 for i in f['instructions'])
checks['exactCfgShape'] = len(f['cfg'])==8 and sum(i['flowType']=='CONDITIONAL_JUMP' for i in f['instructions']) == 2
checks['allCfgDestinationsInRange'] = all(start <= int(e['destination'],16) <= end for b in f['cfg'] for e in b['edges'])
checks['expectedThreeBranchC'] = all(s in f['c'] for s in ['param_2 == 7','param_2 < 0','param_1 * 3 + 5','param_1 - 9','param_1 ^ 0x5a'])
checks['ghidraExecutionSucceeded'] = r['commands'][-1]['exitCode']==0 and not r['commands'][-1]['timeout']
checks['noanalysisExplicit'] = '-noanalysis' in r['commands'][-1]['argv'] and 'enableCodeAnalysis(false)' in (ROOT.parent/'FocusedMachO.java').read_text()
report = {'schema':'fixture-oracle-correction-1', 'status':'passed_local_capability_only' if all(checks.values()) else 'failed',
          'timeUtc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
          'correction': {'originalSource':str(SOURCE/'run_fixture.py'),'incorrectExpectedLanguage':'AARCH64:LE:64:v8A',
                         'correctExpectedLanguage':corrected_language, 'reason':'Installed Ghidra12.1.4 Mach-O loader selected native AppleSilicon language; exact installed language definition confirms 64-bit little-endian AARCH64',
                         'originalFailurePreserved':True, 'ghidraExecutionsThisReview':0, 'fixtureExecutionsThisReview':0},
          'evidence':{str(p):sha(p) for p in [SOURCE/'verification.json',SOURCE/'focused.json',SOURCE/'otool-asm.txt',SOURCE/'run_fixture.py',ROOT.parent/'FocusedMachO.java',ldefs,Path(__file__)]},
          'originalCommandsAllExit0':all(c['exitCode']==0 and not c['timeout'] for c in r['commands']),
          'checks':checks,
          'boundary':'One inherited owned-fixture execution; corrected oracle plus frozen-result checks only; no official runtime or wire/parity evidence'}
with OUT.open('x') as out:
    json.dump(report,out,indent=2);out.write('\n')
print(json.dumps(report,indent=2))
raise SystemExit(0 if report['status']=='passed_local_capability_only' else 1)
