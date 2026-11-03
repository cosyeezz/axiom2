# Mac supervision primitives — alternate public-source acquisition

## Hypothesis and distinction

The ended mac-coalition-wrapper-01 curl/noproxy route obtained no HTTP response. **An existing connected Chrome/OpenCLI background session may have an independently working network route.** This is a new transport capability test, not a restart of that failed curl case or a permission probe. The only goal of this phase is obtaining version-labelled/pinned public `bsd/kern/kern_proc.c` for static review; no syscall authorization conclusion follows from download success.

Before this plan, OpenCLI skills/help and `chrome describe tabs.create` were inspected: installed command supports owned background sessions; live extension reports method available. No user page/cookie/auth data was listed or read. The separate local SessionCreate documentation task t11298/r11300 was also completed under its own read-only assignment budget; its output is evidence, not runtime validation.

## Fixed scope and limits

- One new UUID-scoped owned **background** about:blank session; never bind/select/navigate any user tab. Release it in finally; record cleanup response, do not silently assert stronger cleanup.
- At most3 explicit anonymous browser GETs, sequential, each body<=512KiB/8s browser AbortController; no redirects/retries/search/dependency expansion. Only:
  1. raw.githubusercontent.com/apple-oss-distributions/xnu/xnu-12377.161.14/bsd/kern/kern_proc.c;
  2. only if first unavailable, api.github.com/repos/apple-oss-distributions/xnu/commits/main;
  3. only with a valid complete HTTP200 40hex sha from2, same raw path at that immutable commit.
- Fetch `credentials:'omit'`, `referrerPolicy:'no-referrer'`, `redirect:'error'`, no Authorization/custom headers, no cookie/token inspection. Fetch occurs only in our blank page. Do not evaluate fetched code.
- Fetch phase<=45s, reserve10s cleanup, total alarm60s/CPU15s; each OpenCLI child<=12s and stdout/stderr files<=2MiB (RLIMIT_FSIZE). Evidence total<=24MiB (maximum5CLI calls, two2MiB streams each plus3x512KiB bodies and small manifests), CreateNew directory and exclusive outputs. No forced shell timeout claim as remote-browser OS hard-realtime guarantee.
- OpenCLI is invoked normally with only HOME/PATH/TMPDIR/LANG/LC_ALL; its ordinary bridge configuration may be used internally. No direct reads of Kiro HOME/auth, cookies, Keychain, real TLS keys or raw OpenCLI connection secrets. No API-key/proxy/NODE_OPTIONS inheritance to CLI. Chrome may use its existing network configuration, which is not inspected/modified.
- No package installs/daemon restarts/foreground focus/global trust or proxy changes; no official Kiro/KAS/member execution/import; no process scans/coalition/audit API calls; no real model requests.

## Acceptance and boundaries

Retain exact argv/script, exit/timeout/EOF and complete bounded public body/HTTP/error evidence. HTTP000 is not a server response; CORS/fetch error is not file absence. Exact-tag content is only requested-version-labelled; fallback main must be pinned and is not the running-kernel version. Downloaded source must be read/hash-bound before any static authorization interpretation. Missing body or cleanup remains explicit. Never infer Job/full-tree/deadline equivalence from SessionCreate docs, symbols, source reachability, empty notification or a fake success.
