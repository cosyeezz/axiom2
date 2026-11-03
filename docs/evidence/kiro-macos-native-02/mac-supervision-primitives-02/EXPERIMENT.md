# Documented blank-tab API recovery (new case)

01 ended exit1 before any public request: `browser open about:blank` returns explicit `Blocked URL scheme -- only http:// and https:// are allowed`; cleanup reports its owned session lease released. Preserve01unchanged. This was a navigation-API mismatch, not a network/source result.

New hypothesis: the **documented `browser tab new [url]` with URL omitted** can create an owned blank tab. Exact help confirms optional URL; installed commands/browser.js:523–535 and browser/page.js:225–232 pass no URL when omitted. This does not disable/bypass the navigation URL guard or any CORS/security control. If the supported blank-creation command rejects or returns no owned page identity, stop and release; do not use native APIs/other schemes to get around it.

Use a new UUID-scoped background session. Record and explicitly target only the returned own page with `eval --tab`; confirm location is exactly about:blank before anonymous fetch. Never inspect/list/bind user tabs or cookies.

All other fixed URLs, anonymous fetch/redirect/body/deadline/resource/cleanup and non-execution constraints from [01plan](../mac-supervision-primitives-01/EXPERIMENT.md) remain: at most3publicGET/512KiB each/8s browser timeout,45s fetch phase+10s cleanup/60s alarm/CPU15/2MiB CLI streams/24MiB evidence, no retries, no token/proxy/NODE_OPTIONS inheritance, no official/model/API control calls. Each result is static-public evidence only, not current-kernel or full-tree proof. Main raw outputs use regular files until original CLI child exit and are not pipe-EOF proof. Main fallback only after unavailable exact tag, third only after a valid complete HTTP200 commit pin.
