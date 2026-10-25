// Opt-in network check. Real private Node/npm and package in a disposable root; no host npm required.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { OpenCliService } from "../src/server/integrations/opencli.js";
import { openCliResources } from "../src/server/integrations/opencli-resources.js";
import { openCliConfigPath } from "../src/server/integrations/opencli-runtime.js";

const root = mkdtempSync(join(tmpdir(), "axiom-opencli-live-"));
const service = new OpenCliService(root, () => {}, undefined, () => { throw Error("Host npm intentionally unavailable"); });
const wait = async () => {
  while (service.snapshot().job?.running) await new Promise((r) => setTimeout(r, 50));
  assert.equal(service.snapshot().job?.error, undefined);
  return service.snapshot();
};
try {
  await service.command({ requestId: "check", op: "opencli.check" });
  const checked = await wait();
  assert.equal(checked.version, undefined);
  await service.command({ requestId: "install", op: "opencli.install", params: { version: checked.latest } });
  const installed = await wait();
  assert.equal(installed.version, checked.latest);
  assert.equal(installed.configured, true);
  const resources = openCliResources(root, root);
  assert.equal(resources.warning, undefined);
  assert.deepEqual(resources.skills.map((s) => s.name).sort(), ["opencli-browser", "opencli-usage"]);
  const shell = process.platform === "win32" ? "powershell.exe" : "/bin/sh";
  const args = process.platform === "win32" ? ["-NoProfile", "-NonInteractive", "-Command", "opencli --version"] : ["-c", "opencli --version"];
  const { stdout } = await promisify(execFile)(shell, args, { cwd: root, env: resources.env, timeout: 30_000, windowsHide: true });
  assert.equal(stdout.trim(), installed.version);
  const config = JSON.parse(readFileSync(openCliConfigPath(root), "utf8"));
  assert.ok(config.packageRoot.startsWith(join(root, "integrations", "opencli", "versions")));
  assert.equal(installed.runtimeManaged, true);
  assert.ok(config.runtime?.nodeVersion);
  console.log(`Real npm install and shell lookup passed: OpenCLI ${installed.version}; two official skills; private Node ${config.runtime.nodeVersion}; isolated disposable root.`);
} finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
