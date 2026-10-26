# Minimax 2.5 failure review

Independent counts: protocol completed 20/20; aggregate checks 15/20; strict format 4/20 (1,18,19,20). Completed is not semantic success. Input correlation 20/20; both source hashes matched.
Prior offline replay: answer assertions 17/20; tool assertions 18/20; format agreement 20/20. Answer assertions include code/text shape, not just semantics.

Allowlisted failure classes:
- R10 TOOL_ENCODING: final fields correct, total=56. Set-Content lacked explicit encoding; command contained correct Unicode, readback contained U+FFFD. Content failure is valid. Exact encoding stage unverified; disk bytes not inspected.
- R13 STATIC_CODE_CONTRACT: total=56; callback plus initial-zero fragment present, reduce invocation absent. Explicit source requirement unmet; repair intent evident. Generated code not executed.
- R14 INVENTORY_SCOPE: difference=647 (=703-56), expected 652 (=703-51); archivePlusYellow=323 correct. Prompt specified disk inventory. Scope confusion fits; internal cause unverified. Structured validation also failed.
- R17 TOOL_ENCODING: intended shell failure preceded successful read. Readback matched R10, including U+FFFD. Final checkword correct, total=56. Recovery order valid; file-content check failed.
- R20 VALIDATOR_FALSE_NEGATIVE: single-line JSON fields correct, total=1555. Bare-text regex rejected correct semantics; prompt did not explicitly prohibit JSON.

Prompt limits: R1 supplied 703; R13 supplied initial-zero repair. R14 scope explicit. No numeric/string mismatch explains failures. All 16 format failures contained code fences.
Evidence: kiro-live-check.mjs:201,281; kiro-live-plan.mjs:70,111,119,137,138,188,213.
Prior read-only Node checks exited 0. No tests rerun for persistence; no model/network requests. Cancellation tests not run.
