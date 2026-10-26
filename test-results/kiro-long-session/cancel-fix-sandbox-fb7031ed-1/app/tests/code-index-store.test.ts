import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile, rm, rename, symlink } from "node:fs/promises";
import path from "node:path";
import { indexFixture, implementation, proposal } from "./code-index-fixture.js";
import { SqliteIndexStore } from "../src/server/code-index/store/sqlite.js";
import { AuthorizedReadView } from "../src/server/code-index/query/authorized-view.js";
import { FilePolicy } from "../src/server/code-index/source/policy.js";
import { openHeldFile } from "../src/server/code-index/source/held-file.js";
import { SourceEvidence } from "../src/server/code-index/source/evidence.js";
import { parseProposal } from "../src/server/code-index/domain/schema.js";
import type { ContextDelivery, NodeProposal } from "../src/server/code-index/contracts.js";

const errorCode = (code: string) => (error: unknown) => !!error && typeof error === "object" && "code" in error && error.code === code;
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

test("strict proposal schema rejects extra fields and detaches the caller", async t => {
  const f = await indexFixture(t); await f.put("a.ts", "export const twice = (n:number) => n * 2;");
  const ledger = await f.ledger(), input = proposal(ledger);
  assert.throws(() => parseProposal({ ...input, bypass: true }), errorCode("INVALID_INPUT"));
  const copy = parseProposal(input); input.result.coverage.gaps.push({ code: "extra", description: "mutated" });
  assert.equal(copy.result.coverage.gaps.length, 0);
});

test("SQLite rejects unknown schema/identity before changing persistent journal mode", async t => {
  const f = await indexFixture(t), foreign = path.join(f.directory, "foreign.sqlite");
  const raw = new DatabaseSync(foreign);
  raw.exec("CREATE TABLE meta (key TEXT PRIMARY KEY,value TEXT); INSERT INTO meta VALUES ('schema_version','999'),('index_key','other');"); raw.close();
  const bytes = await readFile(foreign);
  assert.throws(() => new SqliteIndexStore(foreign, "test-index"), errorCode("UNSUPPORTED_SCHEMA"));
  assert.deepEqual(await readFile(foreign), bytes);
  const verify = new DatabaseSync(foreign, { readOnly: true }); assert.equal(verify.prepare("PRAGMA journal_mode").get()?.journal_mode, "delete"); verify.close();
});

test("delivery invalidation is read from the authoritative column after epoch/restart", async t => {
  const f = await indexFixture(t);
  const delivery: ContextDelivery = { deliveryId: "delivery", modelRequestId: "model", indexKey: "test-index", workspaceId: "workspace", policyHash: f.policy.hash, sessionId: "session", runId: "run", contextGeneration: "generation", focus: { version: 1, selectorVersion: "1", branchLeafId: null, latestConsumedInputEntryId: null, userAnchorEntryId: null, signals: [], selections: [] }, packageId: "package", bodyHash: "a".repeat(64), objectRevisions: [], scopeIds: [], state: "included" };
  f.store.putDelivery(delivery); f.store.advance("observed"); assert.equal(f.store.deliveries("session")[0].state, "obsolete");
  f.store.putDelivery(delivery); f.store.close();
  const reopened = new SqliteIndexStore(f.filename, "test-index");
  assert.equal(reopened.deliveries("session")[0].state, "obsolete"); reopened.close();
});

test("concurrent evidence reads preserve both records and revoke cannot be resurrected", async t => {
  const f = await indexFixture(t); await f.put("a.ts", "export const a = 1;"); await f.put("b.ts", "export const b = 2;");
  const ledger = await f.ledger();
  await Promise.all([f.read(ledger, "a.ts"), f.read(ledger, "b.ts")]);
  assert.deepEqual(f.sources.ledger(ledger.ledgerId).sourceRefs.map(ref => ref.path).sort(), ["a.ts", "b.ts"]);
  const next = await f.ledger("revoked"), entered = deferred(), release = deferred(), original = f.policy.read.bind(f.policy);
  f.policy.read = async (name, signal) => { entered.resolve(); await release.promise; return original(name, signal); };
  const operation = f.read(next); await entered.promise; f.sources.revoke(next.ledgerId); release.resolve();
  await assert.rejects(operation, errorCode("SNAPSHOT_EXPIRED")); assert.equal(f.store.ledger(next.ledgerId), null);
});

test("one cancelled scan waiter does not cancel another; unresolved scans preserve anchors", async t => {
  const f = await indexFixture(t, { maxFileBytes: 100 }); await f.put("a.ts", "export const a = 1;");
  await f.sources.reconcile(); const symbol = f.store.objects().find(object => object.kind === "symbol")!;
  const original = f.policy.scan.bind(f.policy), entered = deferred(), release = deferred();
  f.policy.scan = async signal => { entered.resolve(); await release.promise; return original(signal); };
  const cancelled = new AbortController(), first = f.sources.reconcile(cancelled.signal), second = f.sources.reconcile();
  const rejected = assert.rejects(first, { name: "AbortError" }); await entered.promise; cancelled.abort(); await rejected; release.resolve(); await second;
  await f.put("a.ts", "x".repeat(101)); const prior = f.store.epochs(); await f.sources.reconcile();
  assert.equal(f.store.files().find(file => file.path === "a.ts")?.status, "unresolved");
  assert.equal(f.store.object(symbol.id)?.lifecycle, "active");
  assert.ok(f.store.epochs().semanticEpoch > prior.semanticEpoch);
  await f.put("large.txt", "x".repeat(102)); const epoch = f.store.epochs(); await f.sources.reconcile();
  assert.ok(f.store.epochs().observedEpoch > epoch.observedEpoch); assert.ok(f.store.epochs().semanticEpoch > epoch.semanticEpoch);
});

test("Windows holds ancestor identities; POSIX opened file survives path replacement", async t => {
  const f = await indexFixture(t); await f.put("src/a.ts", "export const a = 1;");
  const held = openHeldFile(path.join(f.root, "src", "a.ts"));
  try {
    if (process.platform === "win32") await assert.rejects(rename(path.join(f.root, "src"), path.join(f.root, "old")));
    else { await rename(path.join(f.root, "src"), path.join(f.root, "old")); await symlink(f.directory, path.join(f.root, "src")); }
    assert.equal(held.read(100).toString(), "export const a = 1;");
  } finally { held.close(); }
});

test("only actually read evidence can commit; frozen acceptance and replay are stable", async t => {
  const f = await indexFixture(t); await f.put("a.ts", "export const twice = (n:number) => n * 2;");
  const ledger = await f.ledger(), evidence = await f.read(ledger), input = proposal(ledger, [implementation("tmp:impl", evidence.record.id)]);
  const receipt = f.commits.accept(ledger.ledgerId, input); input.nodes[0].summary = "caller mutation";
  assert.equal(f.store.submission(ledger.requestId), null);
  const committed = await f.commits.commit(ledger.ledgerId, receipt.proposalDigest, async () => {});
  assert.equal(committed.freshness, "current");
  const id = committed.idMap["tmp:impl"], object = f.store.object(id)!;
  assert.equal((object.body as NodeProposal).summary, "将输入乘以二。"); assert.equal(object.recordRev, 1);
  f.sources.revoke(ledger.ledgerId);
  const replay = await f.commits.replay(ledger.requestId, f.owner, receipt.proposalDigest);
  assert.deepEqual(replay, committed);
  await f.put("a.ts", "export const twice = (n:number) => n * 3;");
  assert.equal((await f.commits.replay(ledger.requestId, f.owner, receipt.proposalDigest))?.freshness, "stale");
  await assert.rejects(f.commits.replay(ledger.requestId, { ...f.owner, workspaceId: "other" }, receipt.proposalDigest), errorCode("ACCESS_DENIED"));
  const freshLedger = await f.ledger("unread");
  const bad = f.commits.accept(freshLedger.ledgerId, proposal(freshLedger, [implementation("tmp:bad", evidence.record.id, "Different")]));
  await assert.rejects(f.commits.commit(freshLedger.ledgerId, bad.proposalDigest, async () => {}), errorCode("INVALID_PROPOSAL"));
  assert.equal(f.store.submission(freshLedger.requestId), null);
});

test("final CAS and cancellation are rechecked after asynchronous commit admission", async t => {
  const f = await indexFixture(t); await f.put("a.ts", "export const a = 1;");
  const initial = await f.ledger("initial"), source = await f.read(initial), accept = f.commits.accept(initial.ledgerId, proposal(initial, [implementation("tmp:a", source.record.id)]));
  const result = await f.commits.commit(initial.ledgerId, accept.proposalDigest, async () => {}), id = result.idMap["tmp:a"];
  const ledger = await f.ledger("update"), evidence = await f.read(ledger), old = f.store.object(id)!;
  await f.sources.withLedger(ledger.ledgerId, async live => f.sources.recordObject(live, old));
  const update = implementation(id, evidence.record.id); update.expectedContentRev = old.contentRev; update.expectedRecordRev = old.recordRev; update.summary = "updated";
  const frozen = f.commits.accept(ledger.ledgerId, proposal(ledger, [update]));
  await assert.rejects(f.commits.commit(ledger.ledgerId, frozen.proposalDigest, async () => { f.store.putObject({ ...old, recordRev: old.recordRev + 1 }); }), errorCode("RECORD_CHANGED"));
  assert.equal(f.store.submission(ledger.requestId), null); assert.equal((f.store.object(id)!.body as NodeProposal).summary, "将输入乘以二。");
  const stopped = await f.ledger("stopped"), read = await f.read(stopped), receipt = f.commits.accept(stopped.ledgerId, proposal(stopped, [implementation("tmp:new", read.record.id, "New")]));
  await assert.rejects(f.commits.commit(stopped.ledgerId, receipt.proposalDigest, async () => f.sources.revoke(stopped.ledgerId)), errorCode("SNAPSHOT_EXPIRED"));
  assert.equal(f.store.submission(stopped.requestId), null);
});

test("a statement failure rolls back all semantic rows and the submission", async t => {
  const f = await indexFixture(t); await f.put("a.ts", "export const a = 1;");
  const ledger = await f.ledger(), evidence = await f.read(ledger), input = proposal(ledger, [implementation("tmp:a", evidence.record.id)]);
  const receipt = f.commits.accept(ledger.ledgerId, input), original = f.store.putTerms.bind(f.store);
  f.store.putTerms = () => { throw new Error("injected write failure"); };
  await assert.rejects(f.commits.commit(ledger.ledgerId, receipt.proposalDigest, async () => {}), /injected write failure/);
  f.store.putTerms = original;
  assert.equal(f.store.objects().filter(object => object.kind !== "symbol").length, 0); assert.equal(f.store.submission(ledger.requestId), null);
  assert.equal(f.store.evidence(evidence.record.id), null);
  assert.deepEqual(f.store.doctor().foreignKeys, []);
});

test("policy restrictions hide mixed-source bodies and cyclic proof cannot self-ground", async t => {
  const f = await indexFixture(t); await f.put("a.ts", "export const a = 1;"); await f.put("private.ts", "export const secret = 2;");
  const ledger = await f.ledger(), evidence = await f.read(ledger); await f.read(ledger, "private.ts");
  const receipt = f.commits.accept(ledger.ledgerId, proposal(ledger, [implementation("tmp:a", evidence.record.id)]));
  const result = await f.commits.commit(ledger.ledgerId, receipt.proposalDigest, async () => {}), id = result.idMap["tmp:a"];
  const restricted = await FilePolicy.create(f.root, { excludes: ["private.ts"] }), other = new SourceEvidence(f.store, restricted, "workspace");
  try {
    const snapshot = await other.reconcile(), view = new AuthorizedReadView(f.store, restricted, snapshot, "workspace");
    assert.equal(view.allowed(id), false); assert.equal(view.get(id), null);
  } finally { other.close(); }
  const original = f.store.object(id)!;
  f.store.putObject({ ...original, review: { basis: [{ kind: "object", key: id, version: String(original.contentRev) }], evidenceIds: [], scopeIds: [] } });
  const snapshot = await f.sources.reconcile(), view = new AuthorizedReadView(f.store, f.policy, snapshot, "workspace");
  assert.equal(view.freshness(id), "unresolved");
});
