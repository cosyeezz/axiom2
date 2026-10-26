# Qwen failure review

The 7 failures comprise 4 field-type ambiguities, 1 incomplete tool-input evidence failure, and 2 genuine numeric-answer errors. They do not establish a provider defect.

20 turns; 7 check failures; 0 format failures: 17 JSON-only, 1 prefixed JSON, 2 single-line answers. Format success is distinct from semantics. All input correlations pass; both script hashes match.

- long-06, long-07, long-15, long-19: archive numbers 318 and 427 are correct but encoded as strings. Normalizing only these fields in memory makes all four full semantic checks pass. Prompts name fields without explicitly requiring number types. Source: app/scripts/kiro-live-plan.mjs:53, :99.
- long-10: final-answer semantics pass. Six calls have paired results. The first two stored inputs are exactly 512 characters and fail JSON parsing at kiro-live-plan.mjs:174. kiro-live-check.mjs:130 saves projected inputs without fetching complete inputs; app/src/server/transcript.ts:159 caps them at 512 characters. Complete argument evidence is missing. Final write/read ordering and receipt fields pass; round 17 reads correct fields again. The earlier read is not valid JSON, but retains the expected Chinese word with no replacement characters or question marks. UTF-8 write corruption is not established.
- long-14: difference 683 versus expected 652; the other answer 323 is correct. 683 equals 703 minus sample total 20, consistent with possible total confusion, not proof of its cause.
- long-20: checksum 1866 versus expected 1555. Rounds 14 and 20 independently fail semantic checks; their legacy failures are not false negatives.

Separate type ambiguity, evidence completeness, numeric correctness, and format scores. Read-only Node review; no model code or service requests. Current receipt bytes and original complete tool arguments remain unverified. One diagnostic exited 1 on truncated JSON; guarded follow-ups exited 0.
