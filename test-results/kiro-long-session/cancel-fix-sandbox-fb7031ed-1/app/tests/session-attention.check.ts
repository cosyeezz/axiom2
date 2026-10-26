import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-attention-reconnect-"));
const app = await startServer({ root: join(root, "data"), port: 0 });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const until = async (predicate: () => boolean) => {
  const deadline = Date.now() + 8000;
  while (!predicate()) {
    if (Date.now() > deadline) throw Error("view/reconnect timeout");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
try {
  const run = (op: string, params = {}, workspaceId?: string) =>
    app.store.execute({ requestId: crypto.randomUUID(), op, params, workspaceId });
  const workspace = run("workspace.open", { path: root, authorized: true }) as Workspace;
  const s = run("session.create", {}, workspace.id) as Session;
  const sentinel = run("session.create", {}, workspace.id) as Session;
  app.store.recordResult(s.id, "initial-result", "run");
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((view) => {
    sessionStorage.setItem("view", JSON.stringify(view));
    const NativeSocket = window.WebSocket;
    (window as any).attentionConnections = 0;
    (window as any).attentionFailures = 0;
    window.WebSocket = class extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        (window as any).attentionSocket = this;
        (window as any).attentionConnections++;
      }
      send(data: string | BufferSource | Blob) {
        if (typeof data === "string") {
          const request = JSON.parse(data);
          if (request.op === "subscribe" && request.params.scope === "configuration") {
            // Fail an unrelated subscription while the WebSocket remains open.
            (window as any).attentionFailures++;
            setTimeout(() => this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({
              type: "receipt", requestId: request.requestId, ok: false,
              error: { code: "TEST_SUBSCRIPTION", message: "subscription failure fixture" },
            }) })), 0);
            return;
          }
        }
        super.send(data);
      }
    };
  }, { workspaceId: workspace.id, sessionId: s.id });
  await page.goto(app.origin);
  await page.waitForFunction(() => (window as any).attentionFailures > 0);
  await until(() => !app.store.session(workspace.id, s.id).unread);
  const verifyHeld = async () => {
    app.store.db.prepare("UPDATE sessions SET autoPinUntil=? WHERE id IN (?,?)")
      .run(Date.now() - 1, s.id, sentinel.id);
    await until(() => app.store.session(workspace.id, sentinel.id).autoPinUntil === 0);
    assert.ok(app.store.session(workspace.id, s.id).autoPinUntil! > 0, "foreground view survives subscription diagnostics");
    assert.equal(await page.locator(`[aria-label="置顶会话"] [data-session-id="${s.id}"]`).count(), 1);
  };
  await verifyHeld();
  app.store.recordResult(s.id, "reconnect-result", "run");
  await page.evaluate(() => (window as any).attentionSocket.close());
  await page.waitForFunction(() => (window as any).attentionConnections >= 2 && (window as any).attentionFailures >= 2);
  await until(() => !app.store.session(workspace.id, s.id).unread);
  await verifyHeld();
  assert.deepEqual(errors, []);
  console.log("PASS: unrelated subscription errors preserve foreground protection; reconnect restores the current view without replaying agent commands");
} finally {
  await browser.close();
  await app.close();
  rmSync(root, { recursive: true, force: true });
}
