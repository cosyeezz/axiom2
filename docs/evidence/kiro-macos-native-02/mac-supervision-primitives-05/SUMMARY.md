# Mac supervision source evidence — acquired, not a runtime gate pass

## Result

A separate existing Chrome route acquired public XNU source after the ended curl route received no HTTP response. **No coalition/audit/control API or official/model request was run.** Public source is at immutable main commit **`f6217f891ac0bb64f3d375211650a4c1ff8ca1ea`**, not proven to be the host's xnu12377.161.14 implementation.

The real wrapper at this pin is **`bsd/kern/sys_coalition.c`**, not the previously asserted kern_proc.c. Directory metadata and git-blob SHA bind the selected20,870B file; SHA256=`1f252b9329751286f670a8d6824117c2712b4bf20bbf82376fe12c3d39835545`.

## Bounded acquisition history

All stages have retained EXPERIMENT, executable research harness, exact CLI argv/JS, raw output, public bodies and result manifests; no fetched code was executed.

1. [01](../mac-supervision-primitives-01/browser-results/manifest.json): open about:blank rejected by navigation URL guard, **0publicGET**, harness exit1. No guard was disabled.
2. [02](../mac-supervision-primitives-02/browser-results/manifest.json): documented URL-omitted tab-new creates own background page; eval explicitly targets its returned identity and checks about:blank. Requested exact-version raw path returned completeHTTP404/14B. Expanded commits/main returned200 but crossed512KiB; retained514331B are **partial**, not parsed as a pin. Harness completion0 is not source acquisition success.
3. [03](../mac-supervision-primitives-03/browser-results/manifest.json): new minimal git/ref endpoint returned391B valid40hexpin; pinned kern_proc.c152022B fetched completely. It contains includes/proc_coalitionids, not the syscall wrapper.
4. [04](../mac-supervision-primitives-04/browser-results/manifest.json): same-pin bsd/kern metadata identifies exactly one coalition-named C file, [selected entry](../mac-supervision-primitives-04/browser-results/selected-file.json); fetched sys_coalition.c matches git-blob`cb348caa5aeeeb538709aa6baef61e51a9471b74`.
5. [05](browser-results/manifest.json): complete same-pin user header8912B, private header2067B and internal source83468B. Main compared internal bytes to the previously preserved mutable-main file: **identical**, limiting reuse to these actual bytes now rebound to this public pin.

Total9explicit publicGETs. Fetches used credentialsomit/no-referrer/no redirect/default TLS, no cookie/auth inspection. All created fresh owned background sessions and received successful lease-release cleanup responses; that response is not a stronger independent proof of every native tab/window closing. No user page was bound/listed, focus changed, daemon restarted or global trust/proxy altered.

## Static conclusions at this pin only

- `coalition()` first checks `task_is_in_privileged_coalition(task,type)` then dispatches CREATE/REAP/TERMINATE. **Privileged coalition membership is not simply UID=root.** The internal predicate tests validtype/unrestrict/task membership/privileged flag.
- Terminate arms termination/empty notification. Its own comment says new posix_spawnattr joins begin failing but existing members may still fork. The internal routine marks termrequested/conditionallyterminated and notifies; **it does not kill the tree**.
- Reap requires terminated and empty, returns busy when still active, and consumes a create reference. Ledger uses a separate root check; policy set/get use a separate private entitlement. These must not be conflated with the coalition demux gate.
- [User header](browser-results/01-user-header.body) gives typed create/terminate/reap prototypes. The internal lookup explicitly returnsNULL for cid0; ID allocation starts1. These are useful for designing a later non-mutating capability query, **not permission to blindly call an unbound host ABI**. No such call was made. NULL create output is unsuitable because allocation precedes copyout.
- DEBUG/DEVELOPMENT-only sysctls and unrestrict controls are not release capabilities; none was used or changed.

## Memory correction and local docs

[Path audit](local-reports/path-audit/REPORT.md), t11305/r11306: the old claim originated in a mutable-main **header location comment**, not acquired implementation. The old report itself admitted the actual wrapper was missing; later wording “actually in kern_proc.c” overstrengthened it. Preserve the old evidence; use the newly located wrapper instead. A broad case-insensitive coalition search in pinned kern_proc.c yields6lines, not an unqualified “two references.”

[SessionCreate review](local-reports/sessioncreate/REPORT.md), t11298/r11300: local launchd man documents a new security audit session, and SDK13.3 AuthSession.h describes fork/exec inheritance and membership changes. Neither proves current-user permission, immutable membership, kill-all or authoritative empty completion. No LaunchAgent/Security API was invoked. Both original public installed docs are retained alongside reports.

## Main preservation and remaining work

[preserve_research.py](preserve_research.py) unique run exit0: [seal](preservation.json) covers **109files/2397043B**, including9new read-only byte-verified copies for the two reports and two public installed inputs. All five browser artifacts and harness sources are SHA-bound; no network or process-control test was repeated for preservation.

Mac M3 remains **UNPROVEN**: natural creation/preload applicability, non-escapable complete descendants, independent owner/late-resource/final-publication arbitration and host API authority still need evidence. No finite direct-child, PGID, SessionCreate, notification, source or mock result substitutes for those conditions. Model requests remain0; exact`deepseek-3.2`and native-direct constraints remain unchanged.
