GLM-5 failure review v2 (allowlisted evidence)

Conclusion: Rounds 6 and 7 retrieved/recalled the correct value 318. Both returned ARCHIVE_VALUE as string "318", while the validator required number 318. Classify these as type-sensitive assertion failures with prompt/validator ambiguity, not demonstrated factual or memory errors. Preserve the recorded failures; do not relabel the run as passed.

The prompts requested JSON and named fields but did not explicitly require a numeric JSON type for ARCHIVE_VALUE. The attachment used textual key=value notation. A numeric expectation is reasonable, but the strict type requirement was not explicit.

Round 6: archive key and value content correct. Round 7: archive key, value content, marker and checkword all correct. Both runs completed, inputCorrelated=true, calls/results=0, and own-run failed events=0. No other incorrect required field was found in these two parsed objects.

Independent error: both answers used Markdown code fences, violating JSON-only output; format.complied=false. This remains a failure regardless of numeric-string handling. Records show 18/20 checks passed, exactly these two assertion failures, 16 whole-turn format failures, exit code 1, and no HTTP-429 stop. This does not establish a fully passing protocol run.

Evidence (repository-relative):
- test-results/kiro-long-session/recovery-continuation-v3/glm-5/state.json: rounds at lines 1006/1172; checkFailures at 3923; longSessionPassed=false at 3936.
- Same directory: exit-code.txt; parent directory: summary.json.
- app/scripts/kiro-live-plan.mjs: 45 numeric expectation; 53-54 field-only hints; 101 strict field comparison; 129-130 round assertions.
- app/scripts/kiro-live-check.mjs: 239-242 attachment construction; 271-272 prompts.

Recommendation: specify number type in future prompts, or score value correctness and type compliance separately. Only existing evidence was inspected; no model/test reruns or tested-file changes. Old report retained.
