Needs follow-up before release; no provider regression found by static review.
Scope: F:/Axiom/axiom-kiro-long-session-fb7031ed, HEAD 739146f. Five tracked diffs, five new scripts, six new tests and public evidence inspected. No unrelated delta found; authorship cannot be proven from an unstaged diff. Upstream timeout/keepAlive remain intact (blame: 6b929cc2/e870ee73).

Findings for main agent:
1. Medium: app/scripts/kiro-live-check.mjs:14,19,187-195 validates only some value flags. With valid scope, `send --text --label x` takes '--label' as prompt text and can send it. Validate every value option before connecting; also reject duplicates/unknown flags. Evidence CLI:173 has the same parser weakness, although it is local-only.
2. Release gap: docs/evidence/kiro-long-session/README.md links verification.json, currently absent. Add actual final check results and source hashes after independent checks finish.
3. Evidence limits: kiro-live-plan.mjs:231 calls any completed shell mentioning the path a successful write; a path-only Write-Output can qualify. Line 160 accepts a reduce/zero regex even in a comment or invalid function. These are heuristics, not proof of writing or a complete valid repair. Tighten static validation or narrow claims; never evaluate generated code.

Confirmed: user-boundary omission preserves paired tools and ID deduplication without invented results; thinking stays out of prose. Hydration binds message/call requests, prefix, length and hashes. Long-10 checks the final read and an earlier successful shell. No identity defaults; exporter/native proof use wx; lifecycle reserves output before connecting. Public counts agree: recovery 137/136 completed, 115 semantic and 39 format passes; separate post429 input retained.

No tests/build/services run. Reported 59/59 and build 0 not independently verified; final plan/types pending. Output path is NOT git-ignored in axiom2; main agent must resolve this without staging it.
