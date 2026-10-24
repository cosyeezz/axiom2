import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, rmSync, symlinkSync, linkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RtkService } from "../src/server/integrations/rtk.js";
import { recordRtkEvent, saveRtkOriginal, rtkStats } from "../src/server/integrations/rtk-stats.js";
import { readRtkConfig, rtkConfigPath, atomicRtkJson } from "../src/server/integrations/rtk-config.js";
import { filterRtkResult } from "../src/server/integrations/rtk-runtime.js";
import { rtkDataScope, clearRtkData } from "../src/server/integrations/rtk-data.js";
import { withCommandAdmission } from "../src/server/command-admission.js";
import { cleanupRows, cleanupProgress } from "../src/client/pages/desktop-cleanup.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-rtk-data-"));
  const config = { format: 1 as const, revision: "initial", enabled: false, level: "balanced" as const, subagents: true };
  atomicRtkJson(rtkConfigPath(root), config);
  const event = () => recordRtkEvent(root, { id: randomUUID(), at: Date.now(), role: "main", level: "balanced", filter: "find", reason: "filtered", inputBytes: 100, outputBytes: 10, durationMs: 1, version: "1.0.0" });
  event(); const original = saveRtkOriginal(root, randomUUID(), "keep original");
  return { root, original, event, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
async function settle(service: RtkService) {
  const deadline = Date.now() + 5000;
  while (service.snapshot().job?.running) { assert.ok(Date.now() < deadline); await new Promise(resolve => setImmediate(resolve)); }
  return service.snapshot();
}
for (const kind of ["stats", "originals"] as const) test(`independent RTK ${kind} cleanup confirms exact data and preserves settings and other data`, async () => {
  const f = fixture(); let barriers = 0;
  const service = new RtkService(f.root, () => {}, { removal: async work => { barriers++; return work(); } });
  try {
    const before = service.snapshot(), row = cleanupRows({ rtk: before }).find(row => row.id === `rtk:${kind}`)!;
    assert.equal(row.available, true);
    await service.command({ requestId: randomUUID(), op: row.op, params: { ...row.params, confirm: true, revision: row.revision } });
    const after = await settle(service);
    assert.equal(after.job?.error, undefined); assert.equal(after.dataCleanup?.[kind]?.count, 0);
    assert.equal(barriers, 1); assert.equal(readRtkConfig(f.root).enabled, false);
    assert.equal(cleanupProgress(row, after, after.job?.id).state, "verified");
    assert.equal(existsSync(f.original), kind === "stats");
    assert.equal(rtkStats(f.root).count, kind === "stats" ? 0 : 1);
    assert.equal(existsSync(join(f.root, "integrations/rtk/effects.sqlite")), true);
    assert.notEqual(readRtkConfig(f.root).revision, "initial");
  } finally { await service.close(); f.cleanup(); }
});

test("new originals inside the worker barrier invalidate confirmation before changing config", async () => {
  const f = fixture();
  const service = new RtkService(f.root, () => {}, { removal: async work => { saveRtkOriginal(f.root, randomUUID(), "arrived"); return work(); } });
  try {
    const state = service.snapshot();
    await service.command({ requestId: randomUUID(), op: "rtk.cleanupOriginals", params: { confirm: true, revision: state.revision, cleanupRevision: state.dataCleanup!.originals!.revision } });
    const after = await settle(service);
    assert.match(after.job!.error!, /范围已变化/); assert.equal(readRtkConfig(f.root).revision, "initial"); assert.equal(existsSync(f.original), true);
  } finally { await service.close(); f.cleanup(); }
});

test("original cleanup preserves unrecognized files, symlinks and hardlinks", () => {
  const f = fixture(), dir = join(f.root, "integrations/rtk/originals"), outside = join(f.root, "outside");
  try {
    writeFileSync(outside, "outside"); writeFileSync(join(dir, "keep.txt"), "unknown");
    symlinkSync(outside, join(dir, `${randomUUID()}.txt`)); linkSync(outside, join(dir, `${randomUUID()}.txt`));
    withCommandAdmission(f.root, () => {
      const scope = rtkDataScope(f.root, "originals"); assert.equal(scope.count, 1); assert.equal(scope.retained.length, 3);
      const after = clearRtkData(f.root, "originals", scope.revision); assert.equal(after.count, 0); assert.equal(after.retained.length, 3);
    });
    assert.equal(readFileSync(outside, "utf8"), "outside");
  } finally { f.cleanup(); }
});

test("linked data parent or statistics file cannot authorize deletion", () => {
  const f = fixture(), base = join(f.root, "integrations/rtk"), external = join(f.root, "external");
  try {
    mkdirSync(external); writeFileSync(join(external, "keep"), "outside");
    rmSync(join(base, "originals"), { recursive: true }); symlinkSync(external, join(base, "originals"));
    assert.throws(() => rtkDataScope(f.root, "originals"), /目录被替换/);
    rmSync(join(base, "effects.sqlite")); symlinkSync(join(external, "keep"), join(base, "effects.sqlite"));
    assert.throws(() => rtkDataScope(f.root, "stats"), /链接/);
    assert.equal(readFileSync(join(external, "keep"), "utf8"), "outside");
  } finally { f.cleanup(); }
});

test("a delayed filter result cannot recreate data after cleanup revokes its revision", async () => {
  const f = fixture(), directory = `v1.0.0-${randomUUID()}`, bin = join(f.root, "integrations/rtk/versions", directory);
  try {
    mkdirSync(bin, { recursive: true }); writeFileSync(join(bin, "rtk"), "fixture");
    atomicRtkJson(rtkConfigPath(f.root), { ...readRtkConfig(f.root), enabled: true, installation: { version: "1.0.0", directory } });
    const text = Array.from({ length: 100 }, (_, i) => `src/long-directory/file-${i}.ts`).join("\n");
    const result = await filterRtkResult(f.root, "main", { type: "tool_result", toolName: "bash", toolCallId: "data", input: { command: "rg --files" }, content: [{ type: "text", text }], isError: false, details: undefined, structuredContent: { output: text, exit_code: 0, truncated: false } }, undefined, async () => {
      withCommandAdmission(f.root, () => clearRtkData(f.root, "originals", rtkDataScope(f.root, "originals").revision));
      return Buffer.from("100 files\n");
    });
    assert.equal(result, undefined); assert.equal(rtkDataScope(f.root, "originals").count, 0);
  } finally { f.cleanup(); }
});

for (const broken of ["stats", "originals"] as const) test(`unreadable ${broken} does not block independent cleanup of healthy data`, async () => {
  const f = fixture(), service = new RtkService(f.root, () => {});
  const healthy = broken === "stats" ? "originals" : "stats";
  try {
    if (broken === "stats") writeFileSync(join(f.root, "integrations/rtk/effects.sqlite"), "corrupt database");
    else {
      const dir = join(f.root, "integrations/rtk/originals");
      rmSync(dir, { recursive: true }); symlinkSync(f.root, dir);
    }
    const before = service.snapshot();
    assert.ok(before.dataCleanupErrors?.[broken]); assert.equal(before.dataCleanup?.[broken], undefined);
    const rows = cleanupRows({ rtk: before }), row = rows.find(row => row.id === `rtk:${healthy}`)!;
    assert.equal(row.available, true); assert.equal(rows.some(row => row.id === `rtk:${broken}`), false);
    await service.command({ requestId: randomUUID(), op: row.op, params: { ...row.params, confirm: true, revision: row.revision } });
    const after = await settle(service);
    assert.equal(after.job?.error, undefined); assert.equal(after.dataCleanup?.[healthy]?.count, 0);
    assert.equal(cleanupProgress(row, after, after.job?.id).state, "verified");
    assert.ok(after.dataCleanupErrors?.[broken]);
  } finally { await service.close(); f.cleanup(); }
});

test("data verification cannot use program disappearance as success", () => {
  const f = fixture(), service = new RtkService(f.root, () => {});
  try {
    const state = service.snapshot(), row = cleanupRows({ rtk: state }).find(row => row.id === "rtk:stats")!;
    state.job = { id: "job", kind: "cleanupStats", running: false, message: "done" };
    assert.equal(cleanupProgress(row, state, "job").state, "failed");
  } finally { void service.close(); f.cleanup(); }
});
