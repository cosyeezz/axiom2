# Provenance limits of the retained case17 audit

[Retention manifest](prior-preservation.json) records24 files /79,087B from the completed independent case17/root audit, including [original169 checks](prior-readback/checks.json), original summary/stdout/stderr/exit1, verifier source, targeted three-check correction/exit0 and final171-check aggregate. No old verifier/test/main/otool was rerun during retention.

Two limits must not be lost:

1. `header-correction.py` overwrote the original same-named `REPORT.md`. The retained [REPORT](prior-readback/REPORT.md) is the **final** report, not a separate raw copy of the first failed report. The original failure remains evidenced by its source, checks, summary and original streams/exits. Do not claim the first REPORT file was separately retained or backfill a reconstructed document as an original capture.
2. `seal.py` itself writes `seal.exit=0` and the seal streams before finishing its inventory. That file is **self-declared artifact metadata**, not independent held-process exit evidence. The initial verifier and targeted correction have retained declared exits1/0 and their corresponding data; no new runtime/tool lifecycle proof is inferred from the seal.

The initial oracle expected bare ARM64e subtype2, omitting the actual high capability bit in `0x80000002`. Only three targeted complete header/segment/section checks were added; the original168 PASS were reused without rerun. No repo remediation was needed. This confirms limited static delivery, not callee invocation, authorization, M3 or server parity.
