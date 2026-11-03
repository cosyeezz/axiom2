# Request adapters — bounded internal RAM sinks

Design scope: new request-level adapters only. No model, official startup, authentication, IPC or application import is authorized by these source files/tests. Existing body_pair and earlier pure/end observers remain unchanged. This is not a retry of runtime01 or the failed complete-snapshot protocol.

## Common contract

Explicit install only; importing a module does not patch or subscribe. Trusted ordinary Node objects/intrinsics only, not hostile Proxy/global monkeypatch equivalence. Internal synchronous sink functions are supplied only by the frozen own controller; they may receive raw data **in bounded RAM**, and must never log/persist it. Async/thenable-producing or arbitrary application hooks are outside the supported sink contract. This new explicit sink capability is separate from the old classification-only observer, which remains unchanged. Callback exceptions are swallowed into sticky fixed faults; no inspected/rethrown error/stack/value. No original API calls are suppressed or replayed. Capture failure cannot turn into a pass or affect original return/throw.

Bounds: 128 observed adapter callbacks/API calls, 16 request associations, at most4 submitted candidates, 256KiB per body,64KiB per header,512KiB aggregate observed candidate-body bytes; bounded chunk count256 per candidate. Only fixed scalar snapshots are public. No raw getter/export from observer. Retained internal references are released after submission/close; this is not physical erasure. Closed snapshots are not owner-terminal evidence. A late saved wrapper/callback makes fault sticky; a controller must not convert a previously closed snapshot plus later exit0 into lifecycle proof.

Filter: POST /generateAssistantResponse or POST /v1/responses; also POST / with exact x-amz-target AmazonCodeWhispererStreamingService.GenerateAssistantResponse (current Axiom endpoint is runtime.<service-region>.kiro.dev/). Candidate means recognized request path/target, not exact-model/provenance/API completeness. Other requests are not sent to the RAM sink, especially OAuth refresh/token paths. Do not mistake this bounded filter for complete traffic coverage; cap/unknown data means incomplete. Exact deepseek and all context are checked later without deleting fields. Unknown host/path/query/header names never leave RAM.

## Node ClientRequest adapter

Explicitly wraps ordinary ClientRequest write/end, preserving receiver, original arguments, call count, return and thrown identity. Only one primitive UTF8 end(string) without write/reentry/repeated end is eligible. No response listeners, callbacks, timers, flags or request parameters are injected. Own `_header` data descriptor is read after original end returns. It is a header-cache/API observation, not wire/server receipt. No body from mutable Buffer/write/stream is claimed complete. Changed descriptor owners must not be overwritten on restoration.

The new sink receives an immutable primitive end argument and bounded primitive header-cache string only after successful original end. Subsequent duplicate/write/late calls invalidate the adapter's sampling state; already received values are observations, not a completed transaction/pass. Scope is partial, no all-descendant or universal runtime guarantee.

## Undici diagnostics adapter

Subscribe only to sendHeaders, bodyChunkSent, bodySent and request:error. Do not replace fetch/dispatcher/socket APIs, consume request.body iterators or alter headers/body/transport selection. Correlate by source Request object. Header prefix/view is captured as supplied, not supplemented with expected framing. A body is submitted only after bodySent and complete locally observed bounded chunks, with valid UTF8 roundtrip; this does not prove remote consumption of mutable chunks.

Chunk copying uses native typed-array accessors, rejects shared/resizable backing buffers and does not invoke arbitrary chunk getters/coercion. Ordinary immutable primitive strings may also be copied as UTF8. Copying only defines bytes at diagnostic callback time; a later mutation is not falsely reported as wire equality.

Undici8.10.2 H1 diagnostic headers precede Content-Length/Transfer-Encoding/closing CRLF; H2 diagnostic view is textual, not HPACK, and may precede Expect insertion. Label these distinct boundaries. No forced HTTP1. Source-version compatibility and actual protocol remain runtime claims requiring evidence. Diagnostic event order/shape mismatches yield faults/unknown, not a reconstructed successful request.

## Required own checks before any live case

One narrow control/instrumented comparison for each new adapter with own HTTP/HTTPS server bytes held in RAM, plus bounded unsupported/fault/restoration cases. Separate loopback ports/temp roots for parallel tasks. Verify raw server body and original API callback/return/throw behavior where applicable; response success is not substituted for byte comparison. Preserve finite manifests/source identities and numeric exit provenance; no reruns of passed unchanged components. These checks still will not establish natural official preload installation, complete headers, account scopes or real-model equivalence.
