import assert from "node:assert/strict";
import { test, mock } from "node:test";
import fs, { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "./temporary.js";
import { MemoryOrganizationState } from "../src/server/memory-organization-state.js";
import { PooledMemoryRunner } from "../src/server/memory-runner.js";
import { selection } from "./memory-purpose-fixture.js";
import type { MemoryPurpose } from "../src/shared/memory-tree.js";

const workspaceId = "workspace";
function fixture(purposes: number, attempts: number) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE workspaces(id TEXT PRIMARY KEY); INSERT INTO workspaces VALUES('${workspaceId}');
    CREATE TABLE memory_purposes(id TEXT PRIMARY KEY,workspaceId TEXT,body TEXT,processedAt INTEGER,blocked INTEGER);
    CREATE TABLE memory_purpose_documents(purpose_id TEXT PRIMARY KEY,body TEXT NOT NULL);`);
  const list = Array.from({ length: purposes }, (_, index) => ({ id: `p${String(index).padStart(3, "0")}` }) as MemoryPurpose);
  for (const purpose of list) {
    db.prepare("INSERT INTO memory_purposes VALUES(?,?,?,NULL,0)").run(purpose.id, workspaceId, JSON.stringify({ text: `purpose ${purpose.id}` }));
    db.prepare("INSERT INTO memory_purpose_documents VALUES(?,?)").run(purpose.id, `[\"doc-${purpose.id}\"]`);
  }
  let configurations = 0;
  const state = new MemoryOrganizationState({ db } as never, (_workspace, frozen) => { configurations++; return `config:${frozen.length}`; });
  // Exactly the previous implementation; persisted fingerprints must keep matching.
  const legacy = (version: number, frozen: readonly MemoryPurpose[]) => createHash("sha256").update(JSON.stringify([workspaceId, version, frozen.map(purpose => [purpose.id,
    db.prepare("SELECT body,processedAt,blocked FROM memory_purposes WHERE workspaceId=? AND id=?").get(workspaceId, purpose.id) ?? null,
    db.prepare("SELECT body FROM memory_purpose_documents WHERE purpose_id=?").get(purpose.id)?.body ?? null]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    `config:${frozen.length}`])).digest("hex");
  for (let index = 0; index < attempts; index++) {
    const frozen = list.slice(0, purposes - index);
    db.prepare("INSERT INTO memory_organization_attempts VALUES(?,?,?,?,?,?,?,?,?)").run(legacy(1, frozen), workspaceId,
      JSON.stringify([frozen[0].id]), JSON.stringify(frozen.map(purpose => purpose.id)), "paused", 2, `processing-${index}`, "paused", index);
  }
  const prepares = mock.method(db, "prepare");
  return { db, state, list, legacy, prepares, configurations: () => configurations };
}

test("paused-claim exclusion reuses shared purpose sources and keeps fingerprints exact", () => {
  const { db, state, list, legacy, prepares } = fixture(60, 12);
  for (let round = 0; round < 3; round++) {
    prepares.mock.resetCalls();
    assert.deepEqual([...state.excluded(workspaceId, 1, list)], [list[0].id]);
    // One attempt list query plus at most two shared source statements, not 2 per purpose per attempt.
    assert.ok(prepares.mock.callCount() <= 3, `prepare calls ${prepares.mock.callCount()}`);
  }
  assert.equal(state.fingerprint(workspaceId, 1, list), legacy(1, list));
  assert.equal(state.fingerprint(workspaceId, 2, list.slice(3)), legacy(2, list.slice(3)));

  // Any source change must invalidate reuse: a paused claim whose sources changed is no longer excluded.
  db.prepare("UPDATE memory_purpose_documents SET body=? WHERE purpose_id=?").run("[\"changed\"]", list[0].id);
  assert.deepEqual([...state.excluded(workspaceId, 1, list)], []);
  assert.equal(state.fingerprint(workspaceId, 1, list), legacy(1, list));
  assert.deepEqual([...state.excluded(workspaceId, 2, list)], [], "version is part of the identity");
});

test("organizer configuration key reparses provider files only after they change", () => {
  const dir = mkdtempSync(join(tmpdir(), "axiom-organizer-config-cache-"));
  const save = (contextWindow: number) => {
    writeFileSync(join(dir, "models.json"), JSON.stringify({ providers: { fixture: { models: [{ id: "fixture" }], modelOverrides: {} } } }));
    writeFileSync(join(dir, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "k" } }));
    writeFileSync(join(dir, "models-store.json"), JSON.stringify({ fixture: { models: [{ id: "fixture", contextWindow }] } }));
  };
  const reads = mock.method(fs, "readFileSync"); syncBuiltinESMExports();
  try {
    save(1000);
    const key = () => PooledMemoryRunner.prototype.configurationKey.call({ models: { dir } } as never, selection);
    const first = key(); reads.mock.resetCalls();
    for (let index = 0; index < 5; index++) assert.equal(key(), first);
    assert.equal(reads.mock.callCount(), 0, "unchanged files are not reread");
    save(20000);
    assert.notEqual(key(), first, "a changed catalog still changes the identity");
  } finally { reads.mock.restore(); syncBuiltinESMExports(); rmSync(dir, { recursive: true, force: true }); }
});
