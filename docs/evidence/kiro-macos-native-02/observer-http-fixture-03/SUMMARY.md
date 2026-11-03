# Owned HTTP negative calibration 03 — mixed result, failures retained

This is not Mac M3, an official run, a whole-tree owner, or a server-parity result. No official code, model or external network was used; no OS sandbox was installed. Sources remained frozen: tap `f21dbb781ae4d106763ef327defd0c47f7100cc358a1343fd30d6997de2fc77a`, consumer `0a4871784b92e07baa43f9ad2395e95d6ac0b5250ec390e548f05a9b61193bdf`.

## Strict consumer

[Full summary](reports/consumer/summary.json) and [original suite](reports/consumer/runner.py): 270 independent cases, executed on Python3.9.6 and3.14.7, not540 distinct coverage. System3.9:270pass/exit0. Host3.14:269pass/1fail/exit1. The original controller exit1 is preserved.

`strict_json` accepted a 2000-level raw array on3.14 but rejected it through parser recursion on3.9. The original helper did not state an explicit depth limit. This establishes nondeterministic helper depth handling, **not a full `validate_capture` schema bypass**: invalid nested fields were still rejected. A new case must define an explicit bound before fixing it; do not rewrite this result.

## Runtime negatives

[Initial progress](reports/runtime-failed/progress.json): missing fake guard and existing CreateNew trace both correctly reject startup (Node exit1, real EOF, no terminal; sentinel unchanged).

The first writer-fault injector also intercepted a later terminal write after the trace's numeric FD was closed/reused. [Original failure](reports/runtime-failed/main.log) is retained: harness exit1/empty terminal/JSONDecodeError. This was a test-injector FD-role error, not a tap defect.

A separate new namespace repaired the injector by restoring original `writeSync` immediately after the one targeted trace-FD failure, and executed only the six unfinished branches. [Full report](reports/runtime-fixed/report.json): harness exit0, all six checks passed.

- Writer/body/event/log faults: Node exit0 and original request/end/callback/response counts complete, but terminal stays false/pending0; strict consumer rejects. Body case receives3×96KiB; event case completes40GETs but records at most128events; log case completes20×60000-character-header requests but stops at1026899 log bytes/70events.
- Independent Python-parent deadline kills/reaps original held Node for hang and candidate cases (exit-9, true output EOF). Synthetic artifact-valid early/late files cannot clear that harness's timeout failure. These files were checked **after reap**; no live early-candidate observation window or generic SDK late-result guarantee was proved.

## Permanent preservation and main review

[Manifest](preservation.json):59 files/1773434B, copied read-only and read back byte-for-byte, excluding10own-cache/private-fake entries. The main artifact-only script [preserve_results.py](preserve_results.py) ran once/exit0; it revalidated the270version split, two startup failures, retained original injection traceback, six fixed-namespace results and four strict rejections. No network or child test was repeated.

Positive02 remains separately preserved and valid for its stated fixture boundary. Next: new04explicit JSON depth contract, then only affected consumer tests. No model gate is cleared.
