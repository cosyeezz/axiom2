# Backend automatic publication

A push to `master` starts **Validate Axiom2**. It must pass both Linux native-helper jobs, all six OS/Node packaging jobs, and all 24 OS/Node/test-shard jobs before publication. Four deterministic serial test shards cover every `app/tests/*.test.ts` exactly once per OS/Node combination; the foreground-service suite runs in shard 1. A new push cancels obsolete validation, not an active publication.

**Release Axiom2 Backend** runs when a master push's validation completes. It also checks twice hourly and supports manual dispatch for recovery. GitHub schedules can be delayed; workflow completion is the primary trigger, not a fixed-time delivery promise.

The controller resolves the live master SHA, accepts only this repository's matching push CI run, checks each required job individually, and downloads Linux helper artifacts from that exact run. PR/dispatch builds, skipped checks, stale heads and partial matrices do not authorize publication. It retries failed validation once using `rerun-failed-jobs`; a second failure opens/updates one bot-owned incident issue instead of retrying indefinitely. While validation is active, publication simply waits for its completion event or the next scheduled check.

Publication uses a separate non-cancelling concurrency lock. The existing publisher still checks source freshness, clean version snapshot, native receipts, exact tested package, asset hashes and anonymous public downloads. Version snapshots are direct children of the validated source, change only the five version manifests, and carry `Axiom-Source-Commit`. The snapshot tag is pushed before building to reserve a recoverable version; an interrupted build may leave a reserved tag without a published Release. It must not be manually repointed. Repeated checks reuse the snapshot/draft and verify an already-published release rather than creating duplicates.

The workflow preserves the exact release candidate before attempting publication and keeps failure diagnostics as Actions artifacts. Publication failures open/update the same incident issue, containing source and run links. Successful verification closes bot-owned incidents. A superseded source must not be interpreted as delivered: the newer master still needs its own passing validation and public release verification.

## Recovery

1. Inspect **Release Axiom2 Backend**, its gate output and the linked **Validate Axiom2** run. For test failures, inspect the failed shard log/artifact; fix deterministic failures rather than raising the retry budget or bypassing checks.
2. After fixing and pushing to master, no separate publish command is needed. Dispatch **Release Axiom2 Backend** if immediate reconciliation is desired; it always resolves the current master, not an arbitrary older source. GitHub Issues must remain enabled and Actions must retain `contents: write`, `actions: write`, and `issues: write` permissions for the publisher.
3. Check the resulting Release is public, its tag snapshot points back to the intended source, and its backend archive plus both ownership helpers are anonymously downloadable. A green gate/job or a reserved tag alone is not proof of delivery.
4. Never force-move a release tag, mix artifacts from different CI runs, or upload an unverified replacement package. For a published release whose assets are inconsistent, stop and investigate instead of overwriting public assets.

Desktop and Android publication retain their existing independent signed workflows. This controller publishes backend assets only.
