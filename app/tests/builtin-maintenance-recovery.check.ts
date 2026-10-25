import assert from "node:assert/strict";
import { rmSync } from "node:fs";
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
const app = await startServer({ root: cli.root, port: 0, dev: true, rea: rea.dependencies, openCli: { execute: cli.execute, runtime: cli.runtime, locateNpm: cli.locateNpm } });
let browser: Browser | undefined, socket: WebSocket | undefined, blocked = false;
Object.defineProperty(app.agents, "maintenancePending", { configurable: true, get: () => blocked });
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage(), errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${app.origin}/tools.html#rea`);
  const panel = page.locator("#rea"), recovery = panel.getByRole("group", { name: "核实 REA 中断任务", exact: true });
  await recovery.waitFor();
  assert.equal(await panel.getByRole("button", { name: "安装 REA", exact: true }).isEnabled(), true, "stale pending must not disable installation");
  await recovery.locator("summary").click();
  await recovery.getByRole("button", { name: "确认受控停止并核实", exact: true }).click();
  await recovery.waitFor({ state: "detached" });
  assert.equal(builtinPendingOperation(cli.root, "rea"), undefined);
  await panel.getByRole("button", { name: "安装 REA", exact: true }).click();
  await panel.getByText("REA 与技能已接入；已有会话请重新加载技能与 MCP。", { exact: true }).waitFor();

  await page.goto(`${app.origin}/tools.html#opencli`);
  const open = page.locator("#opencli"), openRecovery = open.getByRole("group", { name: "核实 OpenCLI 中断任务", exact: true });
  await openRecovery.waitFor();
  assert.equal(await open.getByRole("button", { name: "检查更新", exact: true }).isEnabled(), true);
  await openRecovery.getByRole("button", { name: "核实中断任务", exact: true }).click();
  await openRecovery.waitFor({ state: "detached" });
  assert.equal(builtinPendingOperation(cli.root, "opencli"), undefined);

  // Reserve removal behind an already-admitted operation. New external work
  // must not extend that drain indefinitely; cancellation must release it.
  blocked = true;
  await page.goto(`${app.origin}/tools.html#rea`);
  await panel.getByRole("button", { name: "卸载 REA", exact: true }).click();
  await panel.getByRole("group", { name: "确认卸载 REA", exact: true }).getByRole("button", { name: "确认卸载", exact: true }).click();
  const maintenance = panel.getByRole("region", { name: "REA维护", exact: true });
  await maintenance.getByRole("button", { name: "取消任务", exact: true }).waitFor();
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
  ws.send(JSON.stringify({ op: "task.append", requestId, params: { id: "not-admitted", text: "new work" } }));
  assert.deepEqual(await denied, { type: "receipt", requestId, ok: false, error: { code: "MAINTENANCE_BUSY", message: "组件维护已预约；现有任务继续执行，维护完成或取消等待后可开始新操作。" } });
  await maintenance.getByRole("button", { name: "取消任务", exact: true }).click();
  blocked = false;
  await page.waitForFunction(() => [...document.querySelectorAll("#rea button")].some(button => button.textContent === "卸载 REA" && !(button as HTMLButtonElement).disabled));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks: ["stale pending keeps actions enabled", "explicit controlled recovery", "REA install after recovery", "OpenCLI normal recovery", "queued removal blocks new task.append", "queued removal can be cancelled"] }));
} finally { blocked = false; socket?.close(); await browser?.close(); await app.close(); rmSync(cli.root, { recursive: true, force: true }); }
