import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "./temporary.js";
import { Resources, type ResourceNpmExecute } from "../src/server/resources.js";
import { beginNpmOperation, listNpmPending } from "../src/server/resource-npm-operation.js";
import { Store } from "../src/server/storage.js";
import { Capabilities } from "../src/server/capabilities.js";

function file(path: string, value: unknown) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value)); }
async function until(predicate: () => boolean) { for (let i = 0; i < 500; i++) { if (predicate()) return; await delay(10); } assert.fail("fixture did not settle"); }
function fixture(t: TestContext, execute?: ResourceNpmExecute) {
  const root = mkdtempSync(join(tmpdir(), "axiom-npm-parent-")), resourcesRoot = join(root, "resources"), pi = join(root, "shared-pi");
  const previous = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = pi;
  const store = new Store(root); new Capabilities(store, () => {}, pi);
  const resources = new Resources(store, pi, () => {}, async () => {}, execute);
  t.after(async () => { await resources.close(); store.close(); if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; rmSync(root, { recursive: true, force: true }); });
  const begin = (previousDirectory?: string) => {
    const id = randomUUID(), directory = join(resourcesRoot, id);
    const operation = beginNpmOperation(resourcesRoot, { jobId: randomUUID(), directory, scopeId: "global", kind: "mcp", name: "fixture", packageName: "fixture-package" }, join(pi, "mcp.json"), previousDirectory);
    return { id, directory, operation };
  };
  return { root, resourcesRoot, pi, store, resources, begin };
}

test("a ready npm tree stays protected until its parent commits and persists the job", async t => {
  let ready = false, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = fixture(t, async (args, options) => {
    const directory = args[args.indexOf("--prefix") + 1], packageRoot = join(directory, "node_modules", "fixture-package");
    file(join(packageRoot, "package.json"), { name: "fixture-package", version: "1.0.0", bin: "index.js" });
    file(join(packageRoot, "index.js"), "// in-process fixture; no command launched");
    options.onStopped("not-started"); ready = true; await gate; return "";
  });
  const state = await f.resources.refresh();
  await f.resources.command({ requestId: randomUUID(), op: "resources.install", params: { revision: state.revision, kind: "mcp", name: "fixture", source: "fixture-package" } });
  await until(() => ready);
  try {
    const pending = listNpmPending(f.resourcesRoot); assert.equal(pending.length, 1); assert.equal(pending[0].phase, "ready");
    const other = new Resources(f.store, f.pi, () => {}, async () => { assert.fail("live parent must not be replayed"); });
    const current = await other.refresh();
    assert.equal(existsSync(pending[0].directory), true);
    await assert.rejects(other.command({ requestId: randomUUID(), op: "resources.install", params: { revision: current.revision, kind: "mcp", name: "fixture", source: "fixture-package" } }), (error: any) => error.code === "RESOURCE_BUSY");
    await other.close();
  } finally { release(); }
  await until(() => !f.resources.busy);
  assert.equal(f.resources.snapshot().job?.error, undefined);
  assert.equal(listNpmPending(f.resourcesRoot).length, 0);
  const records = JSON.parse(readFileSync(join(f.resourcesRoot, "installed.json"), "utf8")).items;
  assert.equal(records.length, 1); assert.equal(existsSync(records[0].directory), true);
  assert.equal(JSON.parse(readFileSync(join(f.resourcesRoot, "job.json"), "utf8")).job.running, false);
});

test("ready unreferenced staging recovers, while running and unknown journals retain their files", async t => {
  const f = fixture(t);
  const orphan = f.begin(); orphan.operation.readyWith("not-started"); orphan.operation.close();
  await f.resources.refresh();
  assert.equal(existsSync(orphan.directory), false); assert.equal(listNpmPending(f.resourcesRoot).length, 0);
  const running = f.begin(); running.operation.close();
  await f.resources.refresh(); assert.equal(existsSync(running.directory), true);
  assert.equal(listNpmPending(f.resourcesRoot)[0].phase, "running");
});

test("confirmed installed files survive recovery and a referenced old directory retains the transaction", async t => {
  const f = fixture(t), old = join(f.resourcesRoot, randomUUID()); mkdirSync(old, { recursive: true });
  const next = f.begin(old), bin = join(next.directory, "node_modules", "fixture-package", "index.js");
  file(bin, "// fixture");
  file(join(f.resourcesRoot, "installed.json"), { items: [{ id: next.id, scopeId: "global", kind: "mcp", name: "fixture", source: "fixture-package", directory: next.directory, version: "1.0.0" }] });
  file(join(f.pi, "mcp.json"), { mcpServers: { fixture: { command: process.execPath, args: [bin] }, other: { command: process.execPath, args: [join(old, "index.js")] } } });
  next.operation.readyWith("not-started"); next.operation.close();
  await f.resources.refresh();
  assert.equal(existsSync(old), true); assert.equal(existsSync(bin), true); assert.equal(listNpmPending(f.resourcesRoot).length, 1);
  file(join(f.pi, "mcp.json"), { mcpServers: { fixture: { command: process.execPath, args: [bin] } } });
  await f.resources.refresh();
  assert.equal(existsSync(old), false); assert.equal(existsSync(bin), true); assert.equal(listNpmPending(f.resourcesRoot).length, 0);
});

test("a partial parent commit and a replaced directory cannot be deleted by recovery", async t => {
  const f = fixture(t), next = f.begin();
  file(join(f.resourcesRoot, "installed.json"), { items: [{ id: next.id, kind: "mcp", name: "fixture", source: "fixture-package", directory: next.directory }] });
  next.operation.readyWith("not-started"); next.operation.close();
  await f.resources.refresh();
  assert.equal(existsSync(next.directory), true); assert.equal(listNpmPending(f.resourcesRoot).length, 1);
  file(join(f.resourcesRoot, "installed.json"), { items: [] });
  renameSync(next.directory, `${next.directory}-original`); mkdirSync(next.directory);
  await f.resources.refresh();
  assert.equal(existsSync(next.directory), true); assert.equal(listNpmPending(f.resourcesRoot).length, 1);
});

test("executor return without an explicit cleanup proof retains an unknown gate", async t => {
  const f = fixture(t, async () => "");
  const state = await f.resources.refresh();
  await f.resources.command({ requestId: randomUUID(), op: "resources.install", params: { revision: state.revision, kind: "mcp", name: "fixture", source: "fixture-package" } });
  await until(() => !f.resources.busy);
  const pending = listNpmPending(f.resourcesRoot);
  assert.equal(pending.length, 1); assert.equal(pending[0].unconfirmed, true); assert.equal(existsSync(pending[0].directory), true);
  assert.match(f.resources.snapshot().job!.error!, /尚未确认/);
  await f.resources.refresh(); assert.equal(listNpmPending(f.resourcesRoot).length, 1);
});
