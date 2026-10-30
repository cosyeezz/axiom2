import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "./temporary.js";
import { MaintenanceService, currentMaintenance, maintenancePhase } from "../src/server/maintenance.js";
import { managedNode, type NodeRuntime } from "../src/server/integrations/managed-node.js";
import { ReaService } from "../src/server/integrations/rea.js";
import { reaFixture } from "./rea-fixture.js";

const temporary = () => realpathSync(mkdtempSync(join(tmpdir(), "axiom-component-phases-")));
async function settle(service: ReaService) {
  const deadline = Date.now() + 15_000;
  while (service.snapshot().job?.running) {
    assert.ok(Date.now() < deadline, "fixture maintenance did not finish");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(service.snapshot().job?.error, undefined);
}

test("REA explicitly enters installing before npm, regardless of the runtime provider's last phase", async () => {
  for (const previous of ["checking", "verifying", "installing"] as const) {
    const root = temporary(), fixture = reaFixture(), phases: string[] = [];
    const registry = new MaintenanceService(root, () => {
      const phase = registry.snapshot().tasks.findLast(task => task.action === "install")?.phase;
      if (phase && phases.at(-1) !== phase) phases.push(phase);
    });
    const prepare = fixture.dependencies.runtime!.prepare, execute = fixture.dependencies.execute!;
    fixture.dependencies.runtime!.prepare = async (...args) => {
      if (previous === "verifying") { maintenancePhase("downloading"); maintenancePhase("verifying"); }
      const runtime = await prepare(...args);
      maintenancePhase(previous);
      return runtime;
    };
    let npmCalls = 0;
    fixture.dependencies.execute = async (args, options) => {
      if (args[1] === "install") {
        npmCalls++;
        assert.equal(currentMaintenance()?.task.phase, "installing", `npm must not inherit ${previous}`);
        assert.equal(currentMaintenance()?.task.transfer, undefined, "old transfer is cleared before npm");
      }
      return execute(args, options);
    };
    const service = new ReaService(root, () => {}, fixture.dependencies);
    try {
      await service.command({ op: "rea.check", requestId: randomUUID() }); await settle(service);
      await service.command({ op: "rea.install", requestId: randomUUID(), params: { version: "6.7.0" } }); await settle(service);
      assert.equal(npmCalls, 1);
      assert.equal(service.snapshot().version, "6.7.0");
      assert.equal(phases.at(-1), "validating");
      assert.ok(phases.includes("installing"));
      const task = registry.snapshot().tasks.findLast(task => task.action === "install")!;
      assert.deepEqual(task.steps, ["checking", "downloading", "verifying", "installing", "validating"]);
      assert.equal(task.status, "succeeded");
    } finally { await service.close(); registry.close(); rmSync(root, { recursive: true, force: true }); }
  }
});

test("managed Node verifies the archive then reports installing before extraction and self-checks", { skip: process.platform === "win32" }, async t => {
  // Local executable stub/archive only: no actual Node distribution or network.
  const root = temporary(), nodeVersion = process.versions.node, npmVersion = "11.0.0";
  const folder = `node-v${nodeVersion}-${process.platform}-${process.arch}`;
  const stage = join(root, "archive-source"), node = join(stage, folder, "bin", "node");
  const npm = join(stage, folder, "lib", "node_modules", "npm", "bin", "npm-cli.js");
  mkdirSync(dirname(node), { recursive: true }); mkdirSync(dirname(npm), { recursive: true });
  writeFileSync(node, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 'v${nodeVersion}'; else echo '${npmVersion}'; fi\n`); chmodSync(node, 0o700);
  writeFileSync(npm, "// offline fixture npm, never installs a package\n");
  const archive = join(root, "archive.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", stage, folder], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  const bytes = readFileSync(archive), digest = createHash("sha256").update(bytes).digest("hex");
  const asset = `${folder}.tar.gz`, calls: string[] = [], phases: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input); calls.push(url);
    if (url === "https://registry.npmjs.org/rea-agents/6.7.0") return Response.json({ name: "rea-agents", version: "6.7.0", engines: { node: ">=22.19.0" } });
    if (url === "https://nodejs.org/dist/index.json") return Response.json([{ version: `v${nodeVersion}`, npm: npmVersion, lts: "Fixture", files: [process.platform === "darwin" ? `osx-${process.arch}-tar` : `linux-${process.arch}`] }]);
    if (url === `https://nodejs.org/dist/v${nodeVersion}/SHASUMS256.txt`) return new Response(`${digest}  ${asset}\n`);
    if (url === `https://nodejs.org/dist/v${nodeVersion}/${asset}`) return new Response(bytes, { headers: { "Content-Length": String(bytes.length) } });
    assert.fail(`unexpected network URL: ${url}`);
  });
  const prefix = join(root, "integrations", "rea", "versions", `v6.7.0-${randomUUID()}`);
  mkdirSync(prefix, { recursive: true });
  const registry = new MaintenanceService(root, () => {
    const phase = registry.snapshot().tasks.at(-1)?.phase;
    if (phase && phases.at(-1) !== phase) phases.push(phase);
  });
  try {
    let runtime: NodeRuntime | undefined;
    await registry.run({ id: randomUUID(), resource: "rea", label: "offline runtime fixture", action: "install", cancel: true }, new AbortController(), async () => {
      runtime = await managedNode.prepare("rea", prefix, "rea-agents", "6.7.0", currentMaintenance()!.signal, () => {});
      assert.equal(currentMaintenance()!.task.phase, "installing");
      assert.equal(currentMaintenance()!.task.transfer, undefined);
    });
    assert.ok(runtime); assert.equal(runtime.binding.sha256, digest);
    assert.deepEqual(phases.slice(-3), ["downloading", "verifying", "installing"]);
    assert.equal(calls.length, 4, "all official requests are intercepted with offline fixture responses");
    assert.equal(registry.snapshot().tasks.at(-1)?.status, "succeeded");
  } finally { registry.close(); rmSync(root, { recursive: true, force: true }); }
});
