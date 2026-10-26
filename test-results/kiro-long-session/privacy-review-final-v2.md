Privacy/reproducibility review v2 (ASCII)

Only this report is added with wx; damaged v1 is retained. Source, tests, config, evidence, commits and frozen files remain read-only.

Prior review: main/delivery trees matched for 5 scripts, 4 public JSONs and README. JSON scan found no raw bodies, credentials or private session paths. IDs/timestamps remain linkable.

Resolved: check.mjs:29-43 removes private workspace/parent/task defaults; explicit conflicts fail before WS. Preserve commit-scope-audit.md:26 as history. delivery-scope-tests.log records 5/5, exit 0; not rerun. Public lifecycle JSON removes session/basename and keeps one selected record.

Remaining (scripts: app/scripts/kiro-live-*):
- check.mjs:225,312 and plan.mjs:149 hardcode main-tree paths/cwd; portable fixture setup is incomplete.
- docs/evidence/kiro-long-session/README.md:108-114 omits identity setup; :40-42 has stale v3 progress; cross-root recovery lacks a CLI recipe.
- evidence.mjs:109,141,152 passes taskRef, supplemental label and weakly validated run ID through. Prior memory probe confirmed this. Potential disclosure for arbitrary inputs, not observed public JSON leakage.
- evidence.mjs:180 and lifecycle.mjs:23 can overwrite output; native-proof uses wx. Local driver/lifecycle logs contain bodies; native proof retains session metadata. Curate before publishing.

Qwen: integrity issue, not privacy leakage. Current check.mjs:142 copies call.input previews. app/src/server/transcript.ts:159 caps non-task inputs at 512. message-part.ts supports field=input plus callId, returning full text/length/revision. Main agent plans a retrieval fix; this reviewer has neither implemented nor validated it. Recheck full inputs before reclassifying failures.

Prior checks, cwd F:/Axiom/axiom2: node --check on 10 scripts, exit 0; JSON scan and memory probe via node --input-type=module, exit 0. No live requests/build/tests rerun. Earlier 6-hash/8-task gate exit 0 is historical, not current quiescence.
