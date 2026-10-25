import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "./temporary.js";
import { beginBuiltinOperation, builtinPendingOperation, reconcileBuiltinOperation, reconcileBuiltinOperationStopping, recoverBuiltinOperations } from "../src/server/integrations/builtin-operation.js";
import { ReaService } from "../src/server/integrations/rea.js";
import { OpenCliService } from "../src/server/integrations/opencli.js";
import { atomicReaJson, reaConfigPath, readReaConfig } from "../src/server/integrations/rea-runtime.js";
import { createProcessOwner } from "../src/server/process-owner-record.js";
import { forkPidProcess } from "../src/server/maintenance-process-pid.js";

const turn = () => new Promise<void>(resolve => setTimeout(resolve, 10));
async function settle(service: { snapshot(): { job?: { running: boolean } } }) {
  const deadline = Date.now() + 5000;
  while (service.snapshot().job?.running) { assert.ok(Date.now() < deadline); await turn(); }
}
for (const tool of ["rea", "opencli"] as const) test(`${tool} uninstall repairs a stopped parent and preserves unproven old versions`, async () => {
  const root = fs.mkdtempSync(join(tmpdir(), "builtin-recovery-"));
  const selected = `v6.7.0-${randomUUID()}`, orphan = `v6.7.0-${randomUUID()}`;
  const paths = [selected, orphan].map(name => join(root, "integrations", tool, "versions", name));
  for (const path of paths) fs.mkdirSync(path, { recursive: true });
  const engine = join(root, "integrations", "rea", "engines", `java-${randomUUID()}`); fs.mkdirSync(engine, { recursive: true });
  if (tool === "rea") atomicReaJson(reaConfigPath(root), { format: 1, revision: randomUUID(), enabled: true, installation: { version: "6.7.0", directory: selected } });
  else fs.writeFileSync(join(root, "integrations", "opencli.json"), JSON.stringify({ format: 1, revision: randomUUID(), enabled: true, profile: "", window: "foreground", directory: selected, packageRoot: join(paths[0], "node_modules", "@jackwener", "opencli"), binDirectory: join(paths[0], "node_modules", ".bin") }));
  // The exact现场: no command was registered before the old parent stopped.
  const unfinished = beginBuiltinOperation(root, tool); unfinished.close();
  const service = tool === "rea" ? new ReaService(root, () => {}, { removal: async work => work() }) : new OpenCliService(root, () => {});
  try {
    const before = service.snapshot();
    assert.ok(before.pendingOperation); assert.deepEqual(before.cleanupUnverified, [paths[1]]);
    await service.command({ requestId: randomUUID(), op: `${tool}.uninstall`, params: { confirm: true, revision: before.revision, cleanupRevision: before.cleanup!.revision } });
    await settle(service);
    assert.equal(service.snapshot().job?.error, undefined); assert.equal(service.snapshot().pendingOperation, undefined);
    assert.equal(fs.existsSync(paths[0]), false); assert.ok(fs.existsSync(paths[1])); assert.ok(fs.existsSync(engine));
    if (tool === "rea") assert.equal(readReaConfig(root).installation, undefined);
  } finally { await service.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test("global and scoped pending journals can be reconciled without dropping the cross-scope barrier", () => {
  const root = fs.mkdtempSync(join(tmpdir(), "builtin-dual-pending-"));
  try {
    const global = beginBuiltinOperation(root, "rea"); global.finish(); global.close();
    const scoped = beginBuiltinOperation(root, "rea", undefined, "java"); scoped.close();
    const path = join(root, "integrations", ".maintenance", "rea", "current.json");
    const record = JSON.parse(fs.readFileSync(path, "utf8")); record.state = "active"; fs.writeFileSync(path, JSON.stringify(record));
    assert.throws(() => beginBuiltinOperation(root, "rea"));
    reconcileBuiltinOperation(root, "rea", record.id);
    assert.ok(builtinPendingOperation(root, "rea", "java"));
    reconcileBuiltinOperation(root, "rea", builtinPendingOperation(root, "rea", "java"), "java");
    assert.equal(builtinPendingOperation(root, "rea"), undefined);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

for (const tamper of [false, true]) test(`controlled recovery ${tamper ? "rejects changed owner identity without signalling" : "stops its TERM-resistant owned group"}`, { skip: process.platform !== "darwin", timeout: 15000 }, async () => {
  const root = fs.mkdtempSync(join(tmpdir(), "builtin-force-"));
  const operation = beginBuiltinOperation(root, "rea"), path = join(operation.directory, `.axiom-command-${randomUUID()}.json`);
  const journal = createProcessOwner(path); operation.register(path);
  const script = join(root, "resistant.mjs"); fs.writeFileSync(script, "process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000);");
  const owned = forkPidProcess(script, { cwd: root, execArgv: [] }, identity => { journal.arm(identity); operation.armed(path); });
  try {
    const message = Promise.race([once(owned.child, "message"), once(owned.child, "exit").then(() => { throw Error("fixture exited before ready"); })]); await owned.ready; await message;
    journal.revoke(); operation.close();
    const id = builtinPendingOperation(root, "rea");
    await assert.rejects(recoverBuiltinOperations(root, "rea"), { code: "stop-unconfirmed" });
    assert.equal(owned.child.exitCode, null, "automatic recovery only verifies; force must be explicit");
    assert.equal(owned.child.signalCode, null); assert.equal(builtinPendingOperation(root, "rea"), id);
    if (tamper) {
      const record = JSON.parse(fs.readFileSync(path, "utf8")); record.identity.started = "changed"; fs.writeFileSync(path, JSON.stringify(record));
      await assert.rejects(reconcileBuiltinOperationStopping(root, "rea", id), { code: "stop-unconfirmed" });
      assert.equal(owned.child.exitCode, null); assert.equal(owned.child.signalCode, null); assert.equal(builtinPendingOperation(root, "rea"), id);
    } else {
      await reconcileBuiltinOperationStopping(root, "rea", id);
      assert.equal(builtinPendingOperation(root, "rea"), undefined); assert.equal(fs.existsSync(path), false);
    }
  } finally { operation.close(); await owned.close().catch(() => {}); fs.rmSync(root, { recursive: true, force: true }); }
});
