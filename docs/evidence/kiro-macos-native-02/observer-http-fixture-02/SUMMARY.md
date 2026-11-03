# Owned HTTP observer 02 — bounded local calibration passed

This is fake-only calibration on host Node **v22.23.2/darwin/arm64**, not the official embedded Node, Mac M3, whole-tree supervision, TLS wire or final parity. No official or model request was run. The original [01 failures](../observer-http-fixture-01/failed-report-preservation.json) remain unchanged: one reentrant body-cap defect and a separate fake-certificate SAN error.

## Implementation and pure checks

The repaired [tap](fake-http-tap.cjs), SHA`f21dbb781ae4d106763ef327defd0c47f7100cc358a1343fd30d6997de2fc77a`, reserves pending body bytes **before** original write/end calls, rolls reservation back on return/throw, and commits only successful original returns. Pending+committed participates in the cap. Original receiver/arguments/return/exception identity and callbacks remain covered; observer failure is sticky and must not replace the original API behavior.

[Pure report](success-reports/pure/REPORT.md), [results](success-reports/pure/results.json), [delta audit](success-reports/pure/delta-audit.json): the **same original17oracles** now pass plus13new cases, all child exits0/true EOF. This is not30new semantic cases. Source was frozen during tests.

## Real owned HTTP/HTTPS

[Network report](success-reports/network/report.json), [fixture delta](success-reports/network/fixture-delta.json), [post-exit audit](success-reports/network/post-exit-audit.json):

-10control/preload pairs of headers/framing/body match byte-for-byte, without normalizing anything. Original client and comparison logic are unchanged; the new fake SAN includes `DNS:owned.invalid`, without disabling TLS validation.
-8immutable API body reconstructions equal the owned server's body;10header caches equal received plaintext headers.
-**2negative controls:** API captured `BEFORE`, server received `ZZZZZZ` after Buffer mutation. API snapshot is not server receipt.
-HTTP and HTTPS each used one keepalive connection per phase; callback counts, return values and96KiB backpressure matched. Tap totals:54events,196636bodyBytes,268465logBytes,10requests,pending0/oktrue.
-Original Popen child identities, exit0 and true pipe EOF were checked before consuming the known fixture artifacts. This specific Python owner is not a generic SDK/whole-tree lifecycle proof.

## Permanent main readback

[preserve_and_verify.py](preserve_and_verify.py) ran once/exit0, with no test/network repetition. [Manifest](preservation-readback.json): **86files/1147781B** copied read-only, each byte-for-byte read back, excluding6own-HOME/cache/generated-private-fake entries. Main independently recomputed source/suite identities and all10raw,8immutable-body,10header,2mutable-boundary comparisons. Known fake evidence and complete reports are safely retrievable in [success-reports](success-reports).

## Consumer version and remaining boundary

The original [02 consumer](terminal_consumer.py) later exposed cross-interpreter raw JSON depth differences in [03](../observer-http-fixture-03/SUMMARY.md); do not treat that old helper as finally verified. The new [04 experiment](../observer-http-fixture-04/EXPERIMENT.md) defines a16-level limit in a new source, preserving02and03history. Positive02captures are flat and were successfully read back.

No pre-preload captured-method-alias, raw socket/CONNECT, official natural spawn/environment/preload inheritance, full descendants, ordinary SDK final publication, or TLS fingerprint equivalence was proved here. These local passes do not clear the model gate.
