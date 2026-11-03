import ast,hashlib,io,json,resource,signal,sys,tokenize
from pathlib import Path
resource.setrlimit(resource.RLIMIT_CPU,(15,15));resource.setrlimit(resource.RLIMIT_FSIZE,(4194304,4194304));signal.alarm(60)
O=Path('/tmp/new18-independent.4t9BllXr');B=Path('/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02/mac-supervision-primitives-18')
inputs={}
def read(p):
 b=p.read_bytes();inputs[str(p)]={'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()};return b
old=json.loads(read(O/'checks.json'));source=read(B/'inspect_callback_callee.py').decode();v=read(B/'prior-readback/verifier.py').decode();h=read(B/'prior-readback/header-correction.py').decode()
# Target only four failed own-oracle checks. Do not rerun any original passing checks.
failed=[x for x in old if not x['pass']];expected={'inspect_callback_callee.py link raw',"inspect_callback_callee.py link prior_body, expected_range['startVA'], set(",'inspect_callback_callee.py link body, start','subtype oracle evidence'}
assert {x['name'] for x in failed}==expected
# The regex incorrectly spans Python subscripting followed by a call. Markdown syntax applies
# to the three authored .md documents, whose actual links already passed unchanged.
# Confirm these alleged targets belong to Python executable-expression lines, not comments/docs.
lines=source.splitlines();expression_lines=[s for s in lines if any(t in s for t in ["namespace['parse'](raw)","namespace['direct_branches'](prior_body, expected_range['startVA'], set())","namespace['make_carrier'](body, start)"])]
comments=[t.string for t in tokenize.generate_tokens(io.StringIO(source).readline) if t.type==tokenize.COMMENT]
tree=ast.parse(source);docstrings=[ast.get_docstring(n) or '' for n in ast.walk(tree) if isinstance(n,(ast.Module,ast.FunctionDef,ast.ClassDef))]
correction=[{'name':'three Python expression false Markdown links excluded','pass':len(expression_lines)==3 and not any('](' in s for s in comments+docstrings),'detail':'Original link regex incorrectly interpreted namespace[...] calls as Markdown; all real .md links had passed. No links ignored in Markdown documents.'},{'name':'prior original subtype oracle exact split-header expression','pass':'header[:6]==(0xfeedfacf,0x100000c,2,1,1,152)' in v.replace(' ','') and 'header[6:]==(0,0)' in v.replace(' ','') and '0x80000002' in h,'detail':'Original own check expected one contiguous 8-word tuple, but archived verifier compares first6 and last2 separately. Actual historical omission of capability bit remains verified; no old tests executed.'}]
retained=[x for x in old if x['pass']];final=retained+correction
summary={'originalChecks':len(old),'originalPassed':len(retained),'originalOwnOracleFailures':len(failed),'targetedCorrectionChecks':len(correction),'finalAggregate':len(final),'passed':sum(x['pass'] for x in final),'failed':sum(not x['pass'] for x in final),'newRuntimeTests':0}
for name,obj in [('correction-input-SHA256.json',inputs),('correction-checks.json',correction),('final-checks.json',final),('final-summary.json',summary)]:
 with (O/name).open('x') as f:json.dump(obj,f,indent=2);f.write('\n')
report='''# Independent new18 delivery: final audit

Conclusion: bounded case18 static delivery verified. Original own verifier exit1:128/132 PASS plus4 own-oracle false negatives. Targeted correction exit0:2/2 PASS replaces only the4 affected checks;128 unchanged PASS reused, not rerun. Final aggregate130/130, not130 runtime tests. Original REPORT, checks, verifier source, stdout/stderr and exit1 remain untouched; separate correction files preserve the full record.

Own-oracle errors:3 Python namespace-subscript calls were mistaken for Markdown links; actual authored Markdown links had passed.1 historical subtype-source check expected an8-word tuple but source actually checks first6 and last2 words separately. Neither is a delivery defect; no repo remediation.

Evidence: SHA-bound driver; selected AST4functions+2constants; preflight-before-size/exact-entry8192 gate and unknowns fail-closed; raw main exit0/stderr0 and manifest agree.180B/45 contiguous rows [0x1000139b8,0x100013a6c), bodySHA a4f93f643d50e8bdd12c53fcfe72a41e478591d64d9dc3932224fda63b336c1c.364B carrier has complete ARM64e subtype0x80000002 header/segment/section, exact body. All5 manifest artifact SHA/size/0400 plus manifest0400 verified. Read only snapshot702904+180 and1181168+2496:body equal;1764 starts delimit exact range. No whole/slice rehash.

Independent word decoding: MOVx19,x4@139d8; MOVx21,x0@139fc; STPxzr,x19,[x21,#0x40]@13a48 places second slot at+0x48; MOVx0,x21@13a4c. No local callback BR/BLR among45 saved rows. No inference about fixed callees, authorization, runtime or later consumers.

24 newly retained prior files79087B checked SHA/size/0400; inventory23/76158B+own2929B. Historical169=168PASS+1 subtype-oracle failure; final171 exactly same168+3 header checks. Historical verifier/correction declared exits1/0 and raw streams agree. NOTE correctly records overwritten initial REPORT and self-declared seal.exit; no independent seal lifecycle proof.

CWD /Volumes/D_Work/axiom2. Commands: /usr/bin/python3 -I -B verifier.py and correction.py (absolute paths in commands.txt), actual exits1/0; stdout/stderr retained. Each CPU15/wall60/file4MiB; full directory total16MiB gate in independent artifact sealing. No old test/scan/main/otool/helper compile/import/exec; historical source only read as data. No old-source copies rehashed, real binaries/config/credentials/network/control/model, root/17 or19 access. Only two expressly authorized08 snapshot windows. Historical PID61691/exit0/timeoutfalse/wall0.048930084/1717Bstdout/stderr0 checked as recorded metadata, not rerun. Whole/slice identities inherited. Native/M3/server parity remains unproved.
'''
with (O/'FINAL-REPORT.md').open('x') as f:f.write(report)
print(json.dumps(summary));sys.exit(bool(summary['failed']))
