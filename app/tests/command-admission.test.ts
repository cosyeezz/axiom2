import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import fs, { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync, readdirSync, symlinkSync, linkSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { lockCommandAdmission } from "../src/server/command-admission.js";
import { offlineToolRequest } from "../desktop/tool-maintenance.js";
import { atomicRtkJson, rtkConfigPath, readRtkConfig } from "../src/server/integrations/rtk-config.js";
import { filterRtkResult } from "../src/server/integrations/rtk-runtime.js";
import { runRtk } from "../src/server/integrations/rtk-process.js";
import { RtkService } from "../src/server/integrations/rtk.js";
import { runTool } from "../src/server/integrations/tool-process.js";

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "axiom-command-gate-")));
  const directory = `v1.0.0-${randomUUID()}`, bin = join(root, "integrations/rtk/versions", directory, process.platform === "win32" ? "rtk.exe" : "rtk");
  mkdirSync(join(bin, ".."), { recursive: true }); writeFileSync(bin, "fixture", { mode: 0o700 });
  atomicRtkJson(rtkConfigPath(root), { format: 1, revision: "initial", enabled: true, level: "balanced", subagents: true, installation: { version: "1.0.0", directory } });
  const get = () => offlineToolRequest(root, { op: "rtk.get", requestId: randomUUID() }).data;
  const remove = async () => {
    const service = new RtkService(root, () => {}, { removal: async work => work() });
    try {
      await new Promise<void>(resolve => setImmediate(resolve));
      const before = service.snapshot();
      await service.command({ op: "rtk.uninstall", requestId: randomUUID(), params: { confirm: true, revision: before.revision, cleanupRevision: before.cleanup!.revision } });
      const deadline = Date.now() + 5000;
      while (service.snapshot().job?.running) { assert.ok(Date.now() < deadline); await new Promise<void>(resolve => setImmediate(resolve)); }
      return service.snapshot();
    } finally { await service.close(); }
  };
  return { root, bin, get, remove, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
const admissionModule = new URL("../src/server/command-admission.ts", import.meta.url).href;
const toolModule = new URL("../src/server/integrations/tool-process.ts", import.meta.url).href;
const child = (code: string) => spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), "--input-type=module", "-e", code], { encoding: "utf8", timeout: 15000 });

test("command admission excludes another process and is released after abrupt host exit", () => {
  const f = fixture();
  try {
    const release = lockCommandAdmission(f.root);
    try {
      const result = child(`import {lockCommandAdmission} from ${JSON.stringify(admissionModule)}; try {lockCommandAdmission(${JSON.stringify(f.root)});process.exit(2)} catch(e) {if(!e.message.includes('工具正在启动')) throw e}`);
      assert.equal(result.status, 0, result.stderr);
      assert.throws(f.get, /工具正在启动/);
    } finally { release(); }
    const crash = child(`import {lockCommandAdmission} from ${JSON.stringify(admissionModule)}; lockCommandAdmission(${JSON.stringify(f.root)}); process.exit(23)`);
    assert.equal(crash.status, 23, crash.stderr);
    const releaseAgain = lockCommandAdmission(f.root); releaseAgain();
    assert.equal(f.get().version, "1.0.0");
  } finally { f.cleanup(); }
});

test("online removal holds admission after the final barrier and through config revocation", async t => {
  const f = fixture(), rename = fs.renameSync;
  let attempts = 0;
  const mock = t.mock.method(fs, "renameSync", ((source, target) => {
    if (String(target) === rtkConfigPath(f.root)) {
      attempts++;
      const result = child(`import {runTool} from ${JSON.stringify(toolModule)}; try {await runTool(process.execPath,['-e','process.exit(42)'],{root:${JSON.stringify(f.root)}});process.exit(3)} catch(e) {if(!e.message.includes('工具正在启动')) throw e}`);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readdirSync(f.root).some(name => name.startsWith(".axiom-command-")), false);
    }
    return rename(source, target);
  }) as typeof fs.renameSync); syncBuiltinESMExports();
  try { assert.equal((await f.remove()).job?.error, undefined); assert.equal(attempts, 2); assert.equal(existsSync(f.bin), false); }
  finally { mock.mock.restore(); syncBuiltinESMExports(); f.cleanup(); }
});

test("a runtime selected before removal rechecks its revision before publishing an owner", async () => {
  const f = fixture();
  const text = Array.from({ length: 150 }, (_, i) => `src/very-long-directory-name/example-file-${i}.ts`).join("\n");
  let reached = false;
  try {
    const result = await filterRtkResult(f.root, "main", { type: "tool_result", toolName: "bash", toolCallId: "fixture", input: { command: "rg --files" }, content: [{ type: "text", text }], isError: false, structuredContent: { output: text, exit_code: 0, truncated: false }, details: undefined }, undefined, async (file, args, options) => {
      reached = true;
      assert.equal((await f.remove()).job?.error, undefined);
      await assert.rejects(runRtk(file, args, options), /配置已变化/);
      return Buffer.from("should not be applied");
    });
    assert.equal(reached, true); assert.equal(result, undefined);
    assert.equal(readRtkConfig(f.root).installation, undefined);
    assert.equal(readdirSync(f.root).some(name => name.startsWith(".axiom-command-")), false);
  } finally { f.cleanup(); }
});

test("denied command admission reports not-started without publishing an owner", async () => {
  const f = fixture(), release = lockCommandAdmission(f.root); const stopped: string[] = [];
  try {
    await assert.rejects(runTool(process.execPath, [], { root: f.root, onStopped: proof => stopped.push(proof) }), /工具正在启动/);
    assert.deepEqual(stopped, ["not-started"]);
    assert.equal(readdirSync(f.root).some(name => name.startsWith(".axiom-command-")), false);
  } finally { release(); f.cleanup(); }
});

for (const kind of ["symlink", "hardlink", "sidecar"] as const) test(`command admission refuses a ${kind} lock`, () => {
  const f = fixture(), outside = join(f.root, "outside");
  try {
    writeFileSync(outside, "keep");
    if (kind === "symlink") symlinkSync(outside, join(f.root, "command-admission.sqlite"));
    else if (kind === "hardlink") linkSync(outside, join(f.root, "command-admission.sqlite"));
    else symlinkSync(outside, join(f.root, "command-admission.sqlite-wal"));
    assert.throws(() => lockCommandAdmission(f.root), /锁路径无效/);
    assert.equal(fs.readFileSync(outside, "utf8"), "keep");
  } finally { f.cleanup(); }
});
