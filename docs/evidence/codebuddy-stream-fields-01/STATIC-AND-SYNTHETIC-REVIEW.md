# CodeBuddy stream fields: bounded review

## Conclusion

The old Axiom tap can label consumer cancellation as `eof`. This is demonstrated on synthetic Web Streams, not established as the cause of the previous live failure. The supplied historical facts (663 bytes, two `finish: other` frames, terminal error, partial=false) cannot recover nullable field types or the original finish values. No old case was rerun or modified, no credentials were read, and no production/official source was changed.

## Static scope and semantics

Only the six requested source files were reviewed (plus the applicable skill instructions). No runtime/official runner module was imported. The synthetic script imports only inert `PROJECTION.cjs`.

- [AXIOM-RUN.mjs](../codebuddy-cli-compare-01/AXIOM-RUN.mjs), lines 30–32: `finish` is first-writer-wins. `cancel` awaits underlying cancellation before `finish(consumer-cancel)`. Cancel resolves an outstanding underlying `reader.read()` with done=true; the concurrent pull can call `finish(eof)` first. Its subsequent `out.close()` may throw because the outer stream is already cancelled; the catch cannot change the latched EOF. Thus responseExit=eof alone is not proof of clean transport EOF.
- [LIVE-PRELOAD.cjs](../codebuddy-cli-compare-01/LIVE-PRELOAD.cjs), lines 65–73: official-side capture observes Node IncomingMessage data/end/aborted, not the Axiom Web Stream wrapper. No identical await-cancel race appears there; end records transport consumption, not semantic completion or proof of SDK behavior.
- [PROJECTION.cjs](../codebuddy-cli-compare-01/PROJECTION.cjs), lines 43–51, 66–77: missing/null finish collapse to null; empty string, unknown string, number, boolean, array and object collapse to other. Content null/absent/empty also collapse to contentLength=0; deltaKeys records presence, not type. strictTerminal requires explicit stop, one DONE, exact marker and other validity checks. It is a case-specific predicate, not official semantics.
- [client.ts](../../../app/src/native-providers/codebuddy/client.ts), lines 58–61, 81–94, 118–129: missing/null finish is nonterminal; empty finish is terminal error. DONE requires an earlier accepted stop/tool_calls; after DONE parsing continues until clean EOF. Missing/null content or reasoning_content is skipped; empty text emits nothing. Null/empty role is rejected before content, as is function_call=null (presence is forbidden). Null delta is terminal error. tool_calls=null is tool error; [] is accepted. Null refusal is falsey. These are static implementation facts, not proof that upstream permits any null value.
- partial=false means no nonempty text/thinking or tool-start was emitted before failure. It does not prove no content bytes arrived: role/function_call/delta/earlier terminal guards precede content processing. A nonempty content in that same first valid delta would set partial=true before the invalid finish guard; therefore an empty finish alone does not explain partial=false plus an already-emitted nonempty text.
- [sse.ts](../../../app/src/native-providers/codebuddy/sse.ts), lines 27–52: all parser exits cancel the reader in finally; DONE is just a yielded frame, not parser termination. Cancellation is also cleanup on protocol failure, not necessarily caller abort. A truncated SSE record at EOF is rejected.
- [http.ts](../../../app/src/native-providers/codebuddy/http.ts), lines 36–47: request receives AbortSignal and IncomingMessage is adapted with Readable.toWeb. No finish normalization. Actual Node request-abort/Web Stream/SDK interaction was not run.

## Executed offline regression

Working directory: `/Volumes/D_Work/axiom2`.

Command: `node docs/evidence/codebuddy-stream-fields-01/tap-cancel-synthetic-review.mjs`

Actual exit code: **0**, preserved by the shell wrapper. Node v22.23.2. [Command log](tap-cancel-synthetic-command.log), [script](tap-cancel-synthetic-review.mjs), [results/traces](tap-cancel-synthetic-results.json).

8 tap assertions: original vs isolated intent-first proposal, each with pending pull+cancel, DONE followed by simulated SDK abort, true source error, true EOF. Original mislabels both cancellation cases EOF; proposal labels both consumer-cancel; both distinguish real source error and EOF. Nine synthetic old-projection assertions verify finish-value information loss. Passing original cases means the bug was reproduced as expected, not that behavior is correct.

The tap is a reduced lifecycle copy, omitting byte projection, response headers, size cap and request signal guard. Proposal is not a production patch. DONE/SDK-abort is explicitly a consumer cancel wired to a synthetic AbortController, not an actual Pi SDK test. No HTTP, SDK, live, auth, build or production-client execution was performed.

## Minimal future changes (recommendation only)

1. Latch exit intent synchronously before awaiting cancellation; in resumed pull, do not close/enqueue after cancel intent. Keep separate `exitIntent`, `upstreamReadDone`, `cancelStarted`, `cancelSettled`, `signalAborted` and `bodySettled`. Do not count an early logical finish as physical cleanup: the isolated proposal decrements activeBodies early only to preserve the old tap test shape. A real fix must decrement cleanup accounting only after settlement. Classify clean EOF only when no cancellation/error intent has preceded read completion; record first cause and later cleanup separately.
2. For bounded frame/choice/delta fields add a fixed type enum: missing/null/empty-string/nonempty-string/number/boolean/array/object. Use own-property presence. Keep finish known-value enum separately; never retain unknown finish strings, raw errors, text, IDs, headers, or hashes of unknown values. Track delta, role, content, reasoning_content, tool_calls, function_call, refusal, finish_reason; bounded choices count/index classification, DONE count and fixed SSE event classes. Record content length/marker predicate only, with caps; unknown keys only as bounded counts, not raw names.
3. White-list unknown error categories/predicates, preserve existing byte/frame bounds and fail-closed terminal rules. Do not normalize empty finish to stop or treat null/missing finish plus DONE as success based on this evidence.
4. Before any new authorized live case, use new filenames/contracts and real offline SDK + production-client fixtures for cancellation after DONE, actual source error, EOF with and without explicit finish, and nullable-field combinations. These integration tests remain unverified here.
