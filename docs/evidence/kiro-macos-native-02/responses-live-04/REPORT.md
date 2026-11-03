# live-04 — UA matched, native transport acceptance failed

One prompt, session `a180d140-edce-4a1e-be75-ad92c024accd`, run `786a67fe-c3c4-4bba-b920-e686d9ca4261`. Completed in about 19 seconds, exact marker, no tool execution, `kiro-responses-completed`. Claim consumed; never replay this case.

[Safe projection](PROJECTION.json) records all three new flows after the [25-flow baseline](baseline.json): OAuth refresh (`af0d3064`, 200), inference (`4b5bda70`, 200), and a tools-free auxiliary request (`0ab61074`, 200; consistent with title generation, not strictly source-bound). Raw credentials/bodies remain in proxy/browser RAM only.

Main request UA exactly matched the existing official CLI2.36.0/KAS0.66.70 capture, but used HTTP/2 and had Accept, Accept-Language, Accept-Encoding and Sec-Fetch-Mode. Consequently this case **failed its native HTTP acceptance**, despite successful text output. OAuth refresh was also Fetch (`undici`), outside the migrated inference sender.

Source diagnosis: Axiom `provider-request-observer.ts` classified Kiro as HTTP-observable and injected `options.fetch ?? globalThis.fetch`, replacing the native provider default. This was not Pi SDK forcing Fetch. The independent native-sender test did not cover this application wrapper.

Follow-up implementation lets trusted provider registration supply its native fetch-shaped transport for the observer to wrap. New `kiro-native-observer.test.ts` exercises actual ModelRuntime registration/stream and observer, with generic Fetch forbidden and only URL redirected to a synthetic local server. It verifies native HTTP/1.1, exact UA, Connection close, no Fetch supplement headers, preserved caller policy, response hook and request statistics. This is offline evidence, not a retroactive pass for live-04.

Provider proxy was restored through the UI and models.json confirmed builtin profile `71e33e85-237e-43f2-83ae-a0dc887525e8`. optout/attempt/continuation/auth/TLS parity remain separate unresolved boundaries.
