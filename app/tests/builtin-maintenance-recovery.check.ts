import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { reaPackageRoot, readReaConfig } from "../src/server/integrations/rea-runtime.js";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import WebSocket from "ws";
import { chromium, type Browser } from "playwright";
import { startServer } from "../src/server/index.js";
import { beginBuiltinOperation, builtinPendingOperation } from "../src/server/integrations/builtin-operation.js";
import { openCliFixture } from "./fixtures/opencli.js";
import { reaFixture } from "./rea-fixture.js";

const cli = openCliFixture(), rea = reaFixture();
cli.install("1.8.7");
for (const tool of ["rea", "opencli"] as const) {
  const operation = beginBuiltinOperation(cli.root, tool); operation.close();
}
const oldPi = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(cli.root, "pi"); mkdirSync(process.env.AXIOM_PI_DIR);
const app = await startServer({ root: cli.root, port: 0, dev: true, rea: rea.dependencies, openCli: { execute: cli.execute, runtime: cli.runtime, locateNpm: cli.locateNpm } });
let browser: Browser | undefined, socket: WebSocket | undefined;
assert.equal("maintenance" in app.agents.pool, false);
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage(), errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${app.origin}/tools.html#rea`);
  const panel = page.locator("#rea"), recovery = panel.getByRole("group", { name: "核实 REA 中断任务", exact: true });
  await recovery.waitFor();
  assert.equal(await panel.getByRole("button", { name: "安装 REA", exact: true }).isEnabled(), true, "stale pending must not disable installation");
  await recovery.locator("summary").click();
  const pending = builtinPendingOperation(cli.root, "rea");
  const cancelRecovery = recovery.getByRole("button", { name: "暂不停止", exact: true });
  const forceRecovery = recovery.getByRole("button", { name: "确认受控停止并核实", exact: true });
  assert.equal(await forceRecovery.evaluate(button => button.classList.contains("confirm-danger")), true);
  assert.equal(await cancelRecovery.evaluate(button => button.nextElementSibling?.textContent), "确认受控停止并核实");
  await cancelRecovery.click();
  assert.equal(await recovery.locator("details").getAttribute("open"), null);
  assert.equal(builtinPendingOperation(cli.root, "rea"), pending, "cancelling recovery must preserve the interrupted operation");
  await recovery.locator("summary").click();
  await forceRecovery.click();
  await recovery.waitFor({ state: "detached" });
  assert.equal(builtinPendingOperation(cli.root, "rea"), undefined);
  await panel.getByRole("button", { name: "安装 REA", exact: true }).click();
  // Completed task messages are not rendered; observe the installed state instead.
  await panel.getByRole("button", { name: "卸载 REA", exact: true }).click({ trial: true });
  const installedConfig = readReaConfig(cli.root);
  assert.ok(installedConfig.installation);
  // Omitted installation choices mean enabled, just as in ReaService.load().
  assert.notEqual(installedConfig.skillInstalled, false);
  assert.notEqual(installedConfig.mcpInstalled, false);

  await page.goto(`${app.origin}/tools.html#opencli`);
  const open = page.locator("#opencli"), openRecovery = open.getByRole("group", { name: "核实 OpenCLI 中断任务", exact: true });
  await openRecovery.waitFor();
  assert.equal(await open.getByRole("button", { name: "检查更新", exact: true }).isEnabled(), true);
  await openRecovery.getByRole("button", { name: "核实中断任务", exact: true }).click();
  await openRecovery.waitFor({ state: "detached" });
  assert.equal(builtinPendingOperation(cli.root, "opencli"), undefined);

  // Removal has no application-wide reservation or worker barrier.
  const installed = reaPackageRoot(cli.root, readReaConfig(cli.root))!;
  await page.goto(`${app.origin}/tools.html#rea`);
  await panel.getByRole("button", { name: "卸载 REA", exact: true }).click();
  await panel.getByRole("group", { name: "确认卸载 REA", exact: true }).getByRole("button", { name: "确认卸载", exact: true }).click();
  await panel.getByRole("button", { name: "安装 REA", exact: true }).click({ trial: true });
  assert.equal(readReaConfig(cli.root).installation, undefined);
  assert.equal(existsSync(installed), false, "confirmed component files are removed immediately");
  const ws = socket = new WebSocket(app.origin.replace("http", "ws") + "/ws", { origin: app.origin });
  await once(ws, "open");
  const requestId = randomUUID();
  const denied = new Promise<{ ok: boolean; error?: { code: string } }>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("task.append receipt timed out")), 5000);
    ws.on("message", raw => {
      const value = JSON.parse(raw.toString());
      if (value.type === "receipt" && value.requestId === requestId) { clearTimeout(timer); resolve(value); }
    });
  });
  ws.send(JSON.stringify({ op: "task.append", requestId, params: { taskId: "not-admitted", text: "new work" } }));
  const receipt = await denied;
  assert.equal(receipt.ok, false);
  assert.notEqual(receipt.error?.code, "MAINTENANCE_BUSY", "normal task scope validation is not a component-maintenance gate");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks: ["stale pending keeps actions enabled", "explicit controlled recovery", "REA install after recovery", "OpenCLI normal recovery", "confirmed removal physically deletes files", "task.append has no maintenance gate"] }));
} finally { socket?.close(); await browser?.close(); await app.close(); rmSync(cli.root, { recursive: true, force: true }); if (oldPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = oldPi; }
