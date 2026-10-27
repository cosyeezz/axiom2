// Real workbench + isolated source backend. Mutations are held before reaching
// the server: every immediate assertion therefore proves server-independent UI.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type WebSocketRoute } from "playwright";
import { startServer } from "../src/server/index.js";
import type { Command, Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-visual-priority-")), previousPi = process.env.AXIOM_PI_DIR;
mkdirSync(join(root, "pi")); mkdirSync(join(root, "project")); mkdirSync(join(root, "other"));
process.env.AXIOM_PI_DIR = join(root, "pi");
const app = await startServer({ root: join(root, "data"), port: 0, dev: true });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const execute = (op: string, target: Partial<Command> = {}, params = {}) => app.store.execute({ op, requestId: crypto.randomUUID(), ...target, params });
  const workspace = execute("workspace.open", {}, { path: join(root, "project"), authorized: true }) as Workspace;
  const otherWorkspace = execute("workspace.open", {}, { path: join(root, "other"), authorized: true }) as Workspace;
  const otherWorkspaceSession = execute("session.create", { workspaceId: otherWorkspace.id }) as Session;
  const sessions = ["Original", "Other", "Third"].map(title => {
    const s = execute("session.create", { workspaceId: workspace.id }) as Session;
    execute("session.rename", { workspaceId: workspace.id, sessionId: s.id }, { title });
    return { ...s, title };
  });
  const [original, other, third] = sessions;
  execute("session.pin", { workspaceId: workspace.id, sessionId: original.id }, { pinned: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  const heldOps = new Set(["session.create", "session.delete", "session.pin", "session.rename", "workspace.pin", "workspace.rename", "workspace.delete"]);
  type Held = { command: Command; raw: string | Buffer; route: WebSocketRoute; server: WebSocketRoute };
  const queue: Held[] = [];
  await page.routeWebSocket("**/ws", route => {
    const server = route.connectToServer();
    route.onMessage(raw => {
      const command = JSON.parse(raw.toString()) as Command;
      if (heldOps.has(command.op)) queue.push({ command, raw, route, server });
      else server.send(raw);
    });
    server.onMessage(raw => route.send(raw));
  });
  await page.addInitScript(scope => sessionStorage.setItem("view", JSON.stringify(scope)), { workspaceId: workspace.id, sessionId: original.id });
  await page.goto(app.origin);
  await page.locator("#prompt").waitFor();
  await page.locator("#new-chat:enabled").waitFor();
  const row = (id: string) => page.locator(`[data-session-id="${id}"]`);
  const selected = async () => page.evaluate(() => JSON.parse(sessionStorage.getItem("view") || "null")?.sessionId);
  const waitSelected = async (id: string) => page.waitForFunction(id => JSON.parse(sessionStorage.getItem("view") || "null")?.sessionId === id, id);
  const take = async (op: string) => {
    await page.waitForFunction(() => true); // let browser events dispatch
    const deadline = Date.now() + 3000;
    while (!queue.some(item => item.command.op === op) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    const index = queue.findIndex(item => item.command.op === op);
    assert.ok(index >= 0, `${op} dispatched after local feedback`);
    return queue.splice(index, 1)[0];
  };
  const reject = (item: Held, code = "TEST_REJECTED") => item.route.send(JSON.stringify({ type: "receipt", requestId: item.command.requestId, ok: false, error: { code, message: `fixture rejected ${item.command.op}` } }));
  const release = (item: Held) => item.server.send(item.raw);
  const clearError = async () => { const close = page.getByRole("button", { name: "关闭错误提示", exact: true }); if (await close.count()) await close.click(); };

  await page.locator("#prompt").fill("original draft survives");
  await page.locator("#new-chat").click();
  const firstCreate = await take("session.create");
  await page.locator(".topnav").getByText("新对话", { exact: true }).waitFor();
  assert.equal(await selected(), original.id, "temporary IDs never enter durable navigation");
  assert.equal(app.store.sessions(workspace.id).length, 3);
  await page.locator("#prompt").fill("typed before creation response");
  for (let i = 0; i < 5; i++) await page.locator("#new-chat").click();
  assert.equal(queue.filter(item => item.command.op === "session.create").length, 0, "click burst is deduplicated");
  await row(other.id).locator(".history-item").click(); await waitSelected(other.id);
  await page.locator("#new-chat").click();
  assert.equal(await page.locator("#prompt").inputValue(), "typed before creation response", "clicking New after leaving reopens the pending draft immediately");
  assert.equal(queue.filter(item => item.command.op === "session.create").length, 0, "reopening preparation never repeats the write");
  release(firstCreate);
  await page.waitForFunction(old => JSON.parse(sessionStorage.getItem("view")!).sessionId !== old, other.id);
  const created = await selected();
  await page.waitForFunction(() => (document.querySelector("#prompt") as HTMLTextAreaElement)?.value === "typed before creation response");
  await page.locator("#new-chat").click();
  const reuse = await take("session.create");
  assert.equal(await page.locator("#prompt").inputValue(), "typed before creation response", "reuse does not unmount or clear current draft");
  release(reuse);
  await page.locator("#new-chat").getByText("新建会话", { exact: true }).waitFor();
  assert.equal(await selected(), created);

  await row(original.id).locator(".history-item").click(); await waitSelected(original.id);
  assert.equal(await page.locator("#prompt").inputValue(), "original draft survives");
  await page.locator("#new-chat").click();
  const failedCreate = await take("session.create");
  await page.locator("#prompt").fill("recover preparation text");
  reject(failedCreate);
  await page.getByRole("alert").filter({ hasText: "fixture rejected session.create" }).waitFor();
  assert.equal(await selected(), original.id);
  assert.equal(await page.locator("#prompt").inputValue(), "original draft survives");
  await clearError();
  await page.locator("#new-chat").click();
  const lateCreate = await take("session.create");
  assert.equal(await page.locator("#prompt").inputValue(), "recover preparation text", "failed preparation draft is recoverable");
  await row(other.id).locator(".history-item").click(); await waitSelected(other.id);
  release(lateCreate);
  await page.locator("#new-chat").getByText("新建会话", { exact: true }).waitFor();
  assert.equal(await selected(), other.id, "late create must not steal navigation");
  await row(created).locator(".history-item").click(); await waitSelected(created);
  assert.equal(await page.locator("#prompt").inputValue(), "typed before creation response\n\nrecover preparation text", "reused server session merges rather than replaces its existing draft");
  await row(other.id).locator(".history-item").click(); await waitSelected(other.id);
  await page.locator("#new-chat").click();
  const unknownCreate = await take("session.create");
  await page.locator("#prompt").fill("unknown creation draft");
  reject(unknownCreate, "UNCERTAIN");
  const verifyCreation = page.getByRole("button", { name: "核实新建结果", exact: true });
  await verifyCreation.click(); // not_found is not proof of failure.
  assert.equal(await page.locator("#prompt").inputValue(), "unknown creation draft");
  assert.equal(queue.length, 0, "verification never replays a write");
  release(unknownCreate);
  await verifyCreation.click();
  await waitSelected(created);
  assert.equal(await page.locator("#prompt").inputValue(), "typed before creation response\n\nrecover preparation text\n\nunknown creation draft");
  await row(other.id).locator(".history-item").click(); await waitSelected(other.id);
  console.log("PASS new: immediate editable surface, deduplication, reuse, merged drafts, failure recovery, late-reply navigation, unknown receipt verification");

  await row(original.id).hover();
  await row(original.id).locator(".session-pin").click();
  const pin = await take("session.pin");
  assert.equal(await row(original.id).locator(".session-pin").getAttribute("aria-pressed"), "false");
  reject(pin);
  await page.getByRole("alert").filter({ hasText: "fixture rejected session.pin" }).waitFor();
  assert.equal(await row(original.id).locator(".session-pin").getAttribute("aria-pressed"), "true");
  await clearError();
  await row(original.id).locator(".history-item").focus(); await page.keyboard.press("F2");
  const title = page.getByRole("textbox", { name: "会话标题", exact: true });
  await title.fill("Immediate rename"); await title.press("Enter");
  const rename = await take("session.rename");
  assert.equal(await title.count(), 0);
  assert.match(await row(original.id).innerText(), /Immediate rename/);
  reject(rename);
  await page.getByRole("alert").filter({ hasText: "fixture rejected session.rename" }).waitFor();
  assert.match(await row(original.id).innerText(), /Original/);
  await clearError();

  await row(original.id).locator(".history-item").click(); await waitSelected(original.id);
  await row(original.id).locator(".history-item").press("Delete");
  const dialog = page.getByRole("dialog", { name: "删除会话", exact: true });
  await dialog.getByRole("button", { name: "删除会话", exact: true }).click();
  const deletion = await take("session.delete");
  assert.equal(await dialog.count(), 0, "confirmation closes before server response");
  assert.equal(await row(original.id).count(), 0, "pinned/held row disappears before server receives delete");
  assert.notEqual(await selected(), original.id);
  assert.ok(app.store.sessions(workspace.id).some(s => s.id === original.id));
  reject(deletion);
  await page.getByRole("alert").filter({ hasText: "fixture rejected session.delete" }).waitFor();
  await row(original.id).waitFor(); await waitSelected(original.id);
  assert.equal(await page.locator("#prompt").inputValue(), "original draft survives");
  await clearError();

  await row(original.id).locator(".history-item").press("Delete");
  await page.getByRole("dialog", { name: "删除会话", exact: true }).getByRole("button", { name: "删除会话", exact: true }).click();
  const navDelete = await take("session.delete");
  await row(third.id).locator(".history-item").click(); await waitSelected(third.id);
  reject(navDelete);
  await row(original.id).waitFor();
  assert.equal(await selected(), third.id, "rollback never steals a later user navigation");
  await clearError();

  await row(original.id).locator(".history-item").press("Delete");
  await page.getByRole("dialog", { name: "删除会话", exact: true }).getByRole("button", { name: "删除会话", exact: true }).click();
  const uncertain = await take("session.delete");
  reject(uncertain, "UNCERTAIN");
  await page.getByText(/1 项操作结果待确认/).waitFor();
  assert.equal(await row(original.id).count(), 0, "uncertainty does not fabricate a failed deletion");
  release(uncertain); // Original request reaches server late; never send it twice.
  await page.waitForFunction(() => true);
  await page.getByRole("button", { name: "核实结果", exact: true }).click();
  await page.getByText(/1 项操作结果待确认/).waitFor({ state: "hidden" });
  assert.equal(app.store.sessions(workspace.id).some(s => s.id === original.id), false);
  console.log("PASS metadata/delete: immediate pin/title/close/removal; field rollback; guarded navigation; unknown receipt verification");

  const workspaceMenu = async () => {
    if (!(await page.locator("#workspace-picker").evaluate(el => (el as HTMLDetailsElement).open))) await page.locator("#workspace-picker summary").click();
  };
  await workspaceMenu();
  const workspaceRow = page.locator(".workspace-row").filter({ has: page.getByRole("button", { name: otherWorkspace.name, exact: true }) });
  await workspaceRow.hover();
  await workspaceRow.locator(".workspace-pin").click();
  const workspacePin = await take("workspace.pin");
  assert.equal(await workspaceRow.locator(".workspace-pin").getAttribute("aria-pressed"), "true");
  reject(workspacePin);
  await page.getByRole("alert").filter({ hasText: "fixture rejected workspace.pin" }).waitFor();
  assert.equal(await workspaceRow.locator(".workspace-pin").getAttribute("aria-pressed"), "false");
  await clearError(); await workspaceMenu();
  await workspaceRow.locator(".workspace-option").press("Delete");
  await page.getByRole("dialog", { name: "删除工作空间", exact: true }).getByRole("button", { name: "删除工作空间", exact: true }).click();
  const workspaceDelete = await take("workspace.delete");
  assert.equal(await workspaceRow.count(), 0);
  reject(workspaceDelete);
  await page.getByRole("alert").filter({ hasText: "fixture rejected workspace.delete" }).waitFor();
  await workspaceRow.waitFor();
  await clearError(); await workspaceMenu();
  // The current workspace falls back immediately; refusal restores its session
  // even if its first session arrives later and triggers automatic selection.
  const activeWorkspaceRow = page.locator(".workspace-row").filter({ has: page.getByRole("button", { name: workspace.name, exact: true }) });
  await activeWorkspaceRow.locator(".workspace-option").press("Delete");
  await page.getByRole("dialog", { name: "删除工作空间", exact: true }).getByRole("button", { name: "删除工作空间", exact: true }).click();
  const activeWorkspaceDelete = await take("workspace.delete");
  assert.equal(await activeWorkspaceRow.count(), 0);
  await waitSelected(otherWorkspaceSession.id); // Force the automatic recovery path before rejecting.
  reject(activeWorkspaceDelete);
  await page.getByRole("alert").filter({ hasText: "fixture rejected workspace.delete" }).waitFor();
  await activeWorkspaceRow.waitFor(); await waitSelected(third.id);
  assert.deepEqual(errors, []);
  assert.deepEqual(queue, []);
  console.log("PASS workspace: immediate pin/removal with rollback; zero browser runtime errors; no model calls");
} finally {
  await browser.close(); await app.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
