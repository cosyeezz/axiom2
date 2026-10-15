// Opt-in network check. npm's global prefix is redirected to a disposable directory.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { OpenCliService, executeOpenCli } from "../src/server/integrations/opencli.js";
import { openCliResources } from "../src/server/integrations/opencli-resources.js";
import { openCliConfigPath } from "../src/server/integrations/opencli-runtime.js";

const root = mkdtempSync(join(tmpdir(), "axiom-opencli-live-"));
const prefix = join(root, "npm-prefix");
const service = new OpenCliService(root, () => {}, (args, options) => executeOpenCli(args, { ...options, env: { ...options.env, npm_config_prefix: prefix } }));
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
  assert.ok(config.packageRoot.startsWith(prefix));
  console.log(`Real npm install and shell lookup passed: OpenCLI ${installed.version}; two official skills; isolated disposable prefix.`);
} finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
