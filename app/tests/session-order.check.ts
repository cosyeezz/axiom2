import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-session-order-"));
const app = await startServer({ root: join(root, "data"), port: 0 });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const run = (op: string, params = {}, workspaceId?: string, sessionId?: string) =>
    app.store.execute({ requestId: crypto.randomUUID(), op, params, workspaceId, sessionId });
  const open = (name: string) => {
    const path = join(root, name);
    mkdirSync(path);
    return run("workspace.open", { path, authorized: true }) as Workspace;
  };
  const workspace = open("project"), foreign = open("other-project");
  const create = (title: string, updatedAt: number, pinned = false, owner = workspace) => {
    const s = run("session.create", {}, owner.id) as Session;
    run("session.rename", { title }, owner.id, s.id);
    app.store.db.prepare("UPDATE sessions SET updatedAt=?,listOrderAt=?,pinned=? WHERE id=?").run(updatedAt, updatedAt, Number(pinned), s.id);
    return { ...s, title, updatedAt, pinned };
  };
  const pin = create("Manual pin", 1, true);
  const old = create("Older", 2);
  const recent = create("Recent", 100);
  const remote = create("Remote", 3, false, foreign);
  const child = create("Child", 1);
  app.store.db.prepare("INSERT INTO tasks(id,workspaceId,parentSessionId,sessionId,anchor,description,status,budgets,createdAt) VALUES('task',?,?,?,'a','d','completed','{}',1)")
    .run(workspace.id, old.id, child.id);
  for (const s of [old, remote, child])
    app.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES(?,?,'completed','{}',1)").run(s.id, s.id);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((view) => sessionStorage.setItem("view", JSON.stringify(view)), {
    workspaceId: workspace.id, sessionId: recent.id,
  });
  await page.goto(app.origin);
  const waitOrder = async (titles: string[]) => page.waitForFunction((expected) =>
    JSON.stringify([...document.querySelectorAll(".history-item strong")].map((el) => el.textContent)) === JSON.stringify(expected), titles);
  const pins = page.getByRole("region", { name: "置顶会话", exact: true });
  const local = page.getByRole("region", { name: "当前空间对话", exact: true });
  const row = (s: Session) => page.locator(`[data-session-id="${s.id}"]`);
  const publish = (patch: Partial<Session>, target = old) => {
    app.store.db.prepare("UPDATE runs SET status=? WHERE sessionId=?").run(patch.runStatus ?? "completed", target.id);
    app.store.db.prepare("UPDATE sessions SET unread=?,resultVersion=resultVersion+?,readVersion=CASE WHEN ? THEN readVersion ELSE resultVersion END WHERE id=?")
      .run(Number(patch.unread ?? false), Number(patch.unread ?? false), Number(patch.unread ?? false), target.id);
    if (target.id === old.id) app.store.db.prepare("UPDATE tasks SET status=? WHERE id='task'").run(patch.activeTasks ? "running" : "completed");
    app.agents.publish(`sessions:${target.workspaceId}`);
  };
  await waitOrder([pin.title, recent.title, old.title]);
  const prompt = page.locator("#prompt");
  await prompt.fill("Keep this draft");
  for (const patch of [{ runStatus: "starting" }, { runStatus: "running" }, { runStatus: "stopping" }, { activeTasks: true }, { unread: true }] as Partial<Session>[]) {
    publish(patch);
    await waitOrder([old.title, pin.title, recent.title]);
    assert.equal(await pins.locator(`[data-session-id="${old.id}"]`).count(), 1, "automatic priority belongs to the top group");
    assert.equal(await local.locator(`[data-session-id="${old.id}"]`).count(), 0);
    assert.equal(await row(old).count(), 1, "overlapping subscriptions must not duplicate rows");
    assert.equal(await prompt.inputValue(), "Keep this draft");
    assert.equal(await prompt.evaluate((el) => el === document.activeElement), true);
    assert.equal(await page.locator("#chat-title").textContent(), recent.title);
    assert.equal(app.store.session(workspace.id, old.id).pinned, false);
    publish({});
    await waitOrder([pin.title, recent.title, old.title]);
  }
  // Completion stays at the top until read; explicit pins remain after activity ends.
  publish({ runStatus: "completed", unread: true });
  await waitOrder([old.title, pin.title, recent.title]);
  run("session.read", { throughVersion: app.store.session(workspace.id, old.id).resultVersion }, workspace.id, old.id);
  app.agents.publish(`sessions:${workspace.id}`);
  await page.waitForFunction((id) => !document.querySelector(`[data-session-id="${id}"] [aria-label="未读"]`), old.id);
  assert.equal(await pins.locator(`[data-session-id="${old.id}"]`).count(), 1, "reading starts cooling instead of immediately removing the row");
  app.store.db.prepare("UPDATE sessions SET autoPinUntil=? WHERE id=?").run(Date.now() - 1, old.id);
  await waitOrder([pin.title, recent.title, old.title]);
  run("session.pin", { pinned: true }, workspace.id, old.id);
  publish({ runStatus: "running" });
  await waitOrder([old.title, pin.title, recent.title]);
  publish({});
  await waitOrder([old.title, pin.title, recent.title]);
  assert.equal(await pins.locator(".history-row").count(), 2);

  // Concurrent updates used to swap top rows on every updatedAt/selfAuto change.
  app.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES(?,?,'completed','{}',1)").run(pin.id, pin.id);
  publish({ runStatus: "running" }, remote);
  await waitOrder([remote.title, old.title, pin.title, recent.title]);
  await page.evaluate(() => {
    (window as any).__stableTopRows = [...document.querySelectorAll('[aria-label="置顶会话"] .history-row')]
      .map(node => ({ node, id: (node as HTMLElement).dataset.sessionId, y: node.getBoundingClientRect().y }));
  });
  let tick = 0;
  for (const runStatus of ["starting", "running", "stopping", "completed"] as const) {
    for (const target of [old, pin, remote]) {
      const title = `${target.title} update ${++tick}`;
      app.store.db.prepare("UPDATE sessions SET title=?,updatedAt=? WHERE id=?").run(title, 10000 + tick, target.id);
      publish({ runStatus, unread: runStatus === "completed" }, target);
      // Observe changed content, not an already-true order before the delivery.
      await page.waitForFunction(({ id, title }) => document.querySelector(`[data-session-id="${id}"] strong`)?.textContent === title,
        { id: target.id, title });
      assert.equal(await page.evaluate(() => {
        const saved = (window as any).__stableTopRows as { node: Element; id: string; y: number }[];
        const rows = [...document.querySelectorAll('[aria-label="置顶会话"] .history-row')];
        return rows.length === saved.length && rows.every((node, i) => node === saved[i].node && Math.abs(node.getBoundingClientRect().y - saved[i].y) < 1);
      }), true, "status/content updates keep the same DOM rows at the same screen positions");
      assert.equal(await prompt.inputValue(), "Keep this draft");
    }
  }
  for (const target of [old, pin, remote])
    app.store.db.prepare("UPDATE sessions SET title=?,updatedAt=? WHERE id=?").run(target.title, target.updatedAt, target.id);
  app.agents.publish(`sessions:${workspace.id}`);
  await waitOrder([remote.title, old.title, pin.title, recent.title]);
  await page.reload();
  await waitOrder([remote.title, old.title, pin.title, recent.title]);
  console.log("PASS fixed top DOM identity/coordinates across 12 concurrent metadata updates and page reload");
  await prompt.focus();
  publish({}); publish({}, pin); publish({}, remote);
  await waitOrder([old.title, pin.title, recent.title]);
  run("session.pin", { pinned: false }, workspace.id, old.id);
  publish({});
  await waitOrder([pin.title, recent.title, old.title]);

  // A foreign active/unread main session is visible and searchable; child sessions stay excluded.
  app.store.db.prepare("UPDATE runs SET status='running' WHERE sessionId=?").run(child.id);
  app.store.db.prepare("UPDATE sessions SET unread=1 WHERE id=?").run(child.id);
  app.store.db.prepare("UPDATE sessions SET autoPinUntil=0 WHERE id=?").run(remote.id);
  publish({ runStatus: "running" }, remote);
  await waitOrder([remote.title, pin.title, recent.title, old.title]);
  assert.equal(app.store.session(foreign.id, remote.id).autoPinUntil, null, "background activity clears the old returned state");
  app.store.db.prepare("UPDATE sessions SET autoPinUntil=? WHERE id IN (?,?)").run(Date.now() - 1, remote.id, old.id);
  const expiryDeadline = Date.now() + 5000;
  while (app.store.session(workspace.id, old.id).autoPinUntil !== 0) {
    if (Date.now() > expiryDeadline) throw Error("expiry sweep did not run");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(app.store.session(foreign.id, remote.id).autoPinUntil, null, "running sessions do not expire");
  assert.equal(await pins.locator(`[data-session-id="${remote.id}"]`).count(), 1);
  const search = page.getByRole("searchbox", { name: "搜索置顶和当前空间的会话" });
  await search.fill("Remote");
  await waitOrder([remote.title]);
  await search.fill("");
  publish({ unread: true }, remote);
  await waitOrder([remote.title, pin.title, recent.title, old.title]);
  assert.equal(await row(remote).locator(".session-workspace-path").textContent(), foreign.path);
  await row(remote).locator(".history-item").click();
  await page.waitForFunction((id) => document.querySelector(`[data-session-id="${id}"] .history-item`)?.getAttribute("aria-current") === "true" &&
    !document.querySelector(`[data-session-id="${id}"] [aria-label="未读"]`), remote.id);
  await waitOrder([remote.title, pin.title, recent.title, old.title]);
  assert.equal(await page.locator("#chat-title").textContent(), remote.title, "reading keeps the automatic foreign pin open and visible");
  assert.equal(await page.locator("#workspace-picker summary strong").textContent(), workspace.name);
  assert.equal(await page.locator("#title-path").textContent(), foreign.path);
  // Selection hides its unread dot before the asynchronous read acknowledgement.
  const readDeadline = Date.now() + 5000;
  while (app.store.session(foreign.id, remote.id).unread && Date.now() < readDeadline)
    await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(app.store.session(foreign.id, remote.id).unread, false);
  await row(recent).locator(".history-item").click();
  await page.waitForFunction(() => (document.querySelector("#prompt") as HTMLTextAreaElement)?.value === "Keep this draft");
  publish({}, remote);
  await waitOrder([remote.title, pin.title, recent.title, old.title]);
  // Revisit near the old deadline: reading and typing renew it, and foreground reading
  // remains protected even when the persisted deadline is deliberately made overdue.
  app.store.db.prepare("UPDATE sessions SET autoPinUntil=? WHERE id=?").run(Date.now() + 60_000, remote.id);
  await row(remote).locator(".history-item").click();
  await prompt.fill("Remote draft");
  await page.waitForFunction((id) => document.querySelector(`[data-session-id="${id}"] .history-item`)?.getAttribute("aria-current") === "true", remote.id);
  const renewed = app.store.session(foreign.id, remote.id).autoPinUntil!;
  assert.ok(renewed > Date.now() + 120_000, "revisiting renews the five-minute grace period");
  app.store.db.prepare("UPDATE sessions SET autoPinUntil=? WHERE id=?").run(Date.now() - 1, remote.id);
  // A separate expired sentinel proves a real expiry sweep has happened while Remote is held.
  app.store.db.prepare("UPDATE sessions SET autoPinUntil=? WHERE id=?").run(Date.now() - 1, old.id);
  await new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const check = setInterval(() => {
      if (app.store.session(workspace.id, old.id).autoPinUntil === 0) { clearInterval(check); resolve(); }
      else if (Date.now() > deadline) { clearInterval(check); reject(Error("expiry sweep did not run")); }
    }, 20);
  });
  assert.equal(await pins.locator(`[data-session-id="${remote.id}"]`).count(), 1, "passive foreground reading never expires");
  await row(recent).locator(".history-item").click();
  await page.waitForFunction(() => (document.querySelector("#prompt") as HTMLTextAreaElement)?.value === "Keep this draft");
  // Wait for the departure receipt before advancing its stored deadline.
  await new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const check = setInterval(() => {
      if (app.store.session(foreign.id, remote.id).autoPinUntil! > Date.now()) { clearInterval(check); resolve(); }
      else if (Date.now() > deadline) { clearInterval(check); reject(Error("departure did not renew cooling")); }
    }, 20);
  });
  app.store.db.prepare("UPDATE sessions SET autoPinUntil=? WHERE id=?").run(Date.now() - 1, remote.id);
  await waitOrder([pin.title, recent.title, old.title]);
  assert.equal(await local.locator(`[data-session-id="${remote.id}"]`).count(), 0, "foreign sessions return only to their own workspace");
  app.store.db.prepare("UPDATE runs SET status='completed' WHERE sessionId=?").run(child.id);

  // Background state changes defer crossing groups until editing finishes.
  app.store.db.prepare("UPDATE sessions SET autoPinUntil=NULL WHERE id=?").run(old.id);
  await row(old).locator(".history-item").focus();
  await page.keyboard.press("F2");
  const editor = page.getByRole("textbox", { name: "会话标题", exact: true });
  await editor.fill("Unsaved title");
  await editor.evaluate((el) => { el.setAttribute("data-order-test", "original"); });
  publish({ runStatus: "running" });
  await row(old).locator('[aria-label="运行中"]').waitFor();
  assert.equal(await local.locator('[data-order-test="original"]').count(), 1);
  assert.equal(await editor.inputValue(), "Unsaved title");
  assert.equal(await editor.evaluate((el) => el === document.activeElement), true);
  await editor.press("Escape");
  await page.waitForFunction((id) => document.querySelector(`[data-session-id="${id}"] button.history-item`) === document.activeElement, old.id);
  assert.equal(await local.locator(`[data-session-id="${old.id}"]`).count(), 1, "the focused row retains its group even after the editor closes");
  await prompt.focus();
  await waitOrder([old.title, pin.title, recent.title]);
  assert.equal(await pins.locator(`[data-session-id="${old.id}"]`).count(), 1);
  assert.equal(await prompt.inputValue(), "Keep this draft");
  publish({});
  await waitOrder([pin.title, recent.title, old.title]);
  assert.deepEqual(errors, []);
  console.log("PASS: fixed top DOM order/positions through concurrent run, unread, title and timestamp updates plus reload; automatic priority, cooldown, foreign return, manual pins, drafts/focus and deferred editor movement");
} finally {
  await browser.close();
  await app.close();
  rmSync(root, { recursive: true, force: true });
}
