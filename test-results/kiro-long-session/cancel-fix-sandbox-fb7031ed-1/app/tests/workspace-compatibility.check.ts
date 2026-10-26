// Run from app/: npm exec tsx tests/workspace-compatibility.check.ts
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-workspace-compat-"));
const previousPi = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
mkdirSync(process.env.AXIOM_PI_DIR);
const app = await startServer({ root: join(root, "data"), port: 0, dev: true });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const run = (op: string, params = {}, scope?: Partial<Scope>) =>
    app.store.execute({ requestId: crypto.randomUUID(), op, params, ...scope });
  const create = (name: string) => {
    const path = join(root, name);
    mkdirSync(path);
    const workspace = run("workspace.open", { path, authorized: true }) as Workspace;
    const session = run("session.create", {}, { workspaceId: workspace.id }) as Session;
    const scope = { workspaceId: workspace.id, sessionId: session.id };
    run("session.rename", { title: name }, scope);
    run("session.pin", { pinned: true }, scope);
    return { workspace, scope };
  };
  const a = create("工作空间甲"), b = create("工作空间乙");
  for (const legacy of [true, false]) {
    run("workspace.select", { view: a.scope }, { workspaceId: b.workspace.id });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors: string[] = [], subscriptions: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.routeWebSocket("**/ws", (route) => {
      const server = route.connectToServer();
      route.onMessage((message) => {
        const command = JSON.parse(message.toString());
        if (command.op === "subscribe") subscriptions.push(command.params.scope);
        if (legacy && command.op === "subscribe" && command.params.scope === "session-preferences") {
          route.send(JSON.stringify({ type: "receipt", requestId: command.requestId, ok: false,
            error: { code: "INVALID_SCOPE", message: "订阅范围无效" } }));
        } else server.send(message);
      });
      server.onMessage((message) => {
        const event = JSON.parse(message.toString());
        if (legacy && event.type === "snapshot" && event.scope === "workspace-preferences") delete event.data.view;
        route.send(JSON.stringify(event));
      });
    });
    await page.goto(app.origin);
    const expectWorkspace = (name: string) => page.waitForFunction(
      (value) => document.querySelector("#workspace-picker summary strong")?.textContent === value,
      name, { timeout: 5000 });
    await expectWorkspace(b.workspace.name);
    await page.locator("#prompt").waitFor();
    if (!legacy) {
      assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem("view")!).sessionId), a.scope.sessionId,
        "new services restore the main session independently of the sidebar workspace");
    }
    await page.locator("#workspace-picker summary").click();
    await page.getByRole("button", { name: a.workspace.name, exact: true }).click();
    await expectWorkspace(a.workspace.name);
    await page.locator(`[data-session-id="${b.scope.sessionId}"] .history-item`).click();
    await page.waitForFunction((id) => JSON.parse(sessionStorage.getItem("view")!).sessionId === id, b.scope.sessionId);
    await expectWorkspace(a.workspace.name);
    await page.locator("#new-chat").click();
    await page.waitForFunction((scope) => {
      const view = JSON.parse(sessionStorage.getItem("view")!);
      return view.workspaceId === scope.workspaceId && view.sessionId && view.sessionId !== scope.sessionId;
    }, a.scope);
    await page.reload();
    await expectWorkspace(a.workspace.name);
    assert.deepEqual(errors, []);
    assert.ok(!subscriptions.includes("session-preferences"), "optional recovery must not require a new subscription on old services");
    await context.close();
    console.log(`PASS ${legacy ? "legacy" : "current"} service: restore, workspace selection, pinned session, new chat and refresh`);
  }
} finally {
  await browser.close();
  await app.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR;
  else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
