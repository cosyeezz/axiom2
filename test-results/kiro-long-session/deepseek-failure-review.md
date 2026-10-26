# DeepSeek failure review

Scope: frozen recovery-continuation-v3/deepseek-3.2/state.json, 20 rounds. Read-only Node memory parsing; no model/API/WS requests; generated code was not executed.

Protocol: 20/20 completed; zero run errors. Selection, input linkage and assistant run linkage matched recorded evidence. Both script hashes matched the recorded versions.

Semantic: 1 actual arithmetic failure, 2 field-type ambiguities. Round 20 returned 1503; 703+51+56+318+427=1555 (state:3643; kiro-live-check.mjs:290). Rounds 6/7 extracted the correct key and value 318, but represented the value as a numeric string. The prompt specifies field names without an explicit number type; strict deep equality rejects the string (state:1000,1160; kiro-live-plan.mjs:53,101). Label these FIELD_TYPE_AMBIGUITY, not memory failure. Other 17 rounds passed current semantic assertions. No separate legacy assertion false negative was found.

Tools: independent assertions passed 20/20. Rounds 4/17 had expected failures followed by successful ordered reads. Round 10 created the directory, serialized JSON, wrote with explicit UTF-8, then read successfully. The checkword and total 56 survived; round 17 read them correctly again (state:1746; kiro-live-plan.mjs:149). No encoding corruption was observed in stored commands/results; disk bytes were not inspected.

Format: 17 aggregate-assistant format failures. Rounds 2-17 contain fences but yield parseable JSON objects; round 20 is multiline. Rounds 1/18/19 pass. The driver joins all assistant text before checking format; this does not establish invalid final JSON (kiro-live-check.mjs:131; kiro-live-plan.mjs:109).

Code round 13: static inspection confirms accumulator addition, explicit reduce initial value 0, and session total 56; no generated-code execution (state:2393).

References: state lines refer to the scoped state.json; script lines refer to app/scripts/. Review commands exited 0.
