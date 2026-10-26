// Run from app/: npm exec tsx tests/session-drafts.check.ts
// Current source, isolated data, ephemeral port; never starts a model request.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-session-drafts-"));
const previousPi = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
mkdirSync(process.env.AXIOM_PI_DIR);
const app = await startServer({ root: join(root, "data"), port: 0, dev: true });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const run = (op: string, params = {}, scope?: Partial<Scope>) =>
    app.store.execute({ requestId: crypto.randomUUID(), op, params, ...scope });
  const workspace = (name: string) => {
    const path = join(root, name);
    mkdirSync(path);
    return run("workspace.open", { path, authorized: true }) as Workspace;
  };
  const first = workspace("first"), second = workspace("second");
  const sessions = Array.from({ length: 7 }, (_, i) => {
    const owner = i === 6 ? second : first;
    const session = run("session.create", {}, { workspaceId: owner.id }) as Session;
    const scope = { workspaceId: owner.id, sessionId: session.id };
    run("session.rename", { title: `Draft ${i}` }, scope);
    run("session.pin", { pinned: true }, scope);
    return scope;
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [], sends: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.routeWebSocket("**/ws", (route) => {
    const server = route.connectToServer();
    route.onMessage((message) => {
      const command = JSON.parse(message.toString());
      if (/^(prompt|agent\.(prompt|continue|resume)|task\.(append|followup))$/.test(command.op)) {
        sends.push(command.op);
        route.send(JSON.stringify({ type: "receipt", requestId: command.requestId, ok: false,
          error: { code: "TEST_BLOCKED", message: "Draft test blocks model execution" } }));
      } else server.send(message);
    });
    server.onMessage((message) => route.send(message));
  });
  await page.addInitScript((scope) => sessionStorage.setItem("view", JSON.stringify(scope)), sessions[0]);
  await page.goto(app.accessUrl);
  const input = page.locator("#prompt");
  await input.waitFor();
  const select = async (scope: Scope) => {
    await page.locator(`[data-session-id="${scope.sessionId}"] .history-item`).click();
    await page.waitForFunction((id) => document.querySelector(`[data-session-id="${id}"] .history-item`)
      ?.getAttribute("aria-current") === "true", scope.sessionId);
  };
  const texts = sessions.map((_, i) => `会话 ${i} 的未发送草稿\n保留空行、中文与末尾空格  `);
  for (let i = 0; i < sessions.length; i++) {
    await select(sessions[i]);
    assert.equal(await input.inputValue(), "", "a different session starts with its own empty draft");
    await input.fill(texts[i]);
  }
  // Seven views exceed the five-session message cache. Drafts must outlive eviction.
  for (let i = sessions.length - 1; i >= 0; i--) {
    await select(sessions[i]);
    assert.equal(await input.inputValue(), texts[i], "switching back restores the exact original text");
  }
  // Clipboard image upload uses the actual input path and real scoped files.upload.
  await input.press("End");
  await input.evaluate((node) => {
    const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1kAAAAASUVORK5CYII="), (c) => c.charCodeAt(0));
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([bytes], "draft.png", { type: "image/png" }));
    node.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData }));
  });
  await page.getByRole("button", { name: "移除附件：draft.png", exact: true }).waitFor();
  const withImage = await input.inputValue();
  assert.ok(withImage.includes("[imag1]"));
  await select(sessions[6]);
  assert.equal(await page.locator(".attachment-chip").count(), 0);
  await select(sessions[0]);
  assert.equal(await input.inputValue(), withImage);
  assert.equal(await page.getByRole("button", { name: "移除附件：draft.png", exact: true }).count(), 1);
  // Switching during a composition sequence must retain input already emitted by the IME.
  await input.dispatchEvent("compositionstart");
  await input.evaluate((node: HTMLTextAreaElement) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(node, "尚未发送的中文输入");
    node.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", data: "中文输入", isComposing: true }));
  });
  await select(sessions[1]);
  assert.equal(await input.inputValue(), texts[1]);
  await select(sessions[0]);
  assert.equal(await input.inputValue(), "尚未发送的中文输入");
  assert.equal(await page.getByRole("button", { name: "移除附件：draft.png", exact: true }).count(), 1);
  // Creating a new session unmounts the old composer without clearing its draft.
  await page.locator("#new-chat").click();
  await page.waitForFunction((id) => JSON.parse(sessionStorage.getItem("view") || "{}").sessionId !== id, sessions[0].sessionId);
  assert.equal(await input.inputValue(), "");
  await select(sessions[0]);
  assert.equal(await input.inputValue(), "尚未发送的中文输入");
  assert.deepEqual(sends, [], "navigation never submits a draft");
  assert.deepEqual(errors, []);
  console.log("PASS: exact drafts across seven sessions, workspace isolation, message-cache eviction, pasted attachment retention, IME input, new-session navigation and no accidental sends");
} finally {
  await browser.close();
  await app.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR;
  else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
