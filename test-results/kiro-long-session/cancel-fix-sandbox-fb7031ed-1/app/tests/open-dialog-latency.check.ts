// Windows desktop acceptance: actual OS-visible geometry and <1s on EVERY sample.
// Includes the real browser buttons, HTTP routes and prewarmed native host; no picker mocks.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { release, tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { OpenDialog } from "../src/server/open-dialog.js";
import { startServer } from "../src/server/index.js";
import { TaskRecords } from "../src/server/tasks/records.js";
import { messageScope, threadScope } from "../src/shared/agent.js";
import type { Command, Session, Workspace } from "../src/shared/protocol.js";
import { assertCentered, compileWindowProbe, observeNativeWindow } from "./native-open-probe.js";

if (process.platform !== "win32") throw Error("Requires an unlocked Windows desktop session");
const root = mkdtempSync(join(tmpdir(), "axiom-open-timing-"));
const dialog = new OpenDialog();
const previousPi = process.env.AXIOM_PI_DIR;
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Browser | undefined;
const measurements: { label: string; ms: number }[] = [];
try {
  const probe = compileWindowProbe(root);
  async function measure(label: string, title: string, open: () => Promise<unknown>, settled?: () => Promise<unknown>) {
    const observer = await observeNativeWindow(probe, title);
    const started = performance.now();
    const operation = open();
    void operation.catch(() => {});
    try {
      const visible = await observer.next();
      const ms = Math.round(performance.now() - started);
      measurements.push({ label, ms });
      console.log(`${label}: ${ms} ms to OS-visible window`);
      assertCentered(visible);
      assertCentered(await observer.next());
      await observer.close();
      await operation;
      await settled?.();
      assert.ok(ms < 1000, `${label} took ${ms} ms; every sample must be below 1000 ms`);
    } finally { await observer.close().catch(() => {}); }
  }

  const prepared = performance.now();
  await dialog.prepare();
  console.log(`Service preparation (before clicks): ${Math.round(performance.now() - prepared)} ms`);
  // File/folder/mixed x single/multiple, including immediately replenished hosts.
  for (const kind of ["folder", "file", "mixed"] as const) for (const multiple of [false, true]) {
    await measure(`${kind}/${multiple ? "multiple" : "single"}`, "Axiom latency test", async () => {
      const paths = await dialog.select({ title: "Axiom latency test", kind, multiple, initialDirectory: root }, new AbortController().signal);
      assert.deepEqual(paths, []);
    });
  }
  await dialog.close();

  const project = join(root, "项目 空格 # % & ' +"), pi = join(root, "pi");
  mkdirSync(project); mkdirSync(pi); mkdirSync(join(root, "other-tab"));
  const selection = { provider: "picker-fixture", id: "fixture", thinking: "off" as const };
  writeFileSync(join(pi, "models.json"), JSON.stringify({ providers: {
    [selection.provider]: { api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", models: [{ id: "fixture", name: "Picker Fixture", input: ["text"] }] },
  } }));
  writeFileSync(join(pi, "auth.json"), JSON.stringify({ [selection.provider]: { type: "api_key", key: "isolated-test-only" } }));
  process.env.AXIOM_PI_DIR = pi;
  app = await startServer({ root: join(root, "data"), port: 0, dev: true });
  const workspace = app.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  app.store.db.prepare("INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?)").run(session.id, JSON.stringify(selection));
  const records = new TaskRecords(app.store);
  const taskId = records.create(scope, "picker-delegate", "picker fixture", [{ task: "选择器子会话" }], selection).taskIds[0];
  app.store.db.prepare("UPDATE tasks SET status='completed' WHERE id=?").run(taskId);
  app.store.db.prepare("DELETE FROM task_inputs WHERE taskId=?").run(taskId);
  const task = records.list(scope).tasks[0];
  browser = await chromium.launch({ headless: false, executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((view) => sessionStorage.setItem("view", JSON.stringify(view)), scope);
  // Only seed a delegation message to expose the real child-session button; tasks, scopes and HTTP stay real.
  const delegation = { id: "delegation", role: "assistant", text: "选择器测试", calls: [{ id: task.anchor, name: "delegate", input: "{}" }] };
  const messages = new Map<string, unknown>([
    [threadScope(scope), { ids: [delegation.id] }],
    [messageScope(scope, delegation.id), delegation],
    [`messages:${workspace.id}:${session.id}`, [delegation]],
  ]);
  await page.routeWebSocket("**/ws", (route) => {
    const server = route.connectToServer();
    let seq = 0;
    route.onMessage((raw) => {
      const command = JSON.parse(raw.toString()) as Command;
      const key = String(command.params?.scope ?? "");
      if (["subscribe", "unsubscribe"].includes(command.op) && messages.has(key)) {
        if (command.op === "subscribe") route.send(JSON.stringify({ type: "snapshot", scope: key, streamId: "picker-test", seq: ++seq, data: messages.get(key) }));
        route.send(JSON.stringify({ type: "receipt", requestId: command.requestId, ok: true, data: {} }));
      } else server.send(raw);
    });
    server.onMessage((raw) => route.send(raw));
  });
  await page.goto(app.origin);
  await page.locator('.connection-status[data-connected="true"]').waitFor();
  await page.bringToFront();
  for (let i = 0; i < 3; i++) {
    await page.locator("#workspace-picker > summary").click();
    const response = page.waitForResponse("**/api/workspace/pick-folder");
    await measure(`workspace button ${i + 1}`, "打开工作空间文件夹", () => page.locator("#add-workspace").click(), async () => {
      assert.deepEqual(await (await response).json(), { path: null });
      await page.waitForFunction(() => document.querySelector<HTMLButtonElement>("#add-workspace")?.disabled === false);
    });
    await page.locator("#prompt").click(); // Close the menu and restore the foreground app.
  }
  // Explorer is shell-owned: observe only this isolated directory, and close only its window.
  // Existing minimized/maximized windows must be restored/recentered without creating another.
  const retained: Awaited<ReturnType<typeof observeNativeWindow>>[] = [];
  const tabbedExplorer = Number(release().split(".")[2]) >= 22621;
  async function closeRetained() {
    const results = await Promise.allSettled(retained.splice(0).map((observer) => observer.close()));
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
  async function measureExplorer(label: string, state?: "minimized" | "maximized" | "inactive-tab", retain = false) {
    await page.bringToFront();
    const observer = await observeNativeWindow(probe, "", { directory: project, state });
    await page.bringToFront();
    await page.locator(".title-meta").hover(); // The design reveals path actions on hover/focus.
    const response = page.waitForResponse("**/api/workspace/reveal?*");
    void response.catch(() => {});
    const started = performance.now();
    const click = page.getByRole("button", { name: "打开系统文件管理器", exact: true }).click();
    void click.catch(() => {});
    let keep = false;
    try {
      const visible = await observer.next();
      const ms = Math.round(performance.now() - started);
      measurements.push({ label, ms });
      console.log(`${label}: ${ms} ms to foreground, centered Explorer`);
      assertCentered(visible);
      assert.equal(visible.foreground, visible.handle, "requested Explorer is the foreground window");
      const settledWindow = await observer.next();
      assertCentered(settledWindow);
      assert.equal(settledWindow.foreground, settledWindow.handle, "requested Explorer stays in the foreground after layout");
      await click;
      assert.equal((await response).status(), 204);
      assert.ok(ms < 1000, `${label} took ${ms} ms; every sample must be below 1000 ms`);
      if (retain) { retained.push(observer); keep = true; }
      return visible;
    } finally { if (!keep) await observer.close(); }
  }
  try {
    for (let i = 0; i < 3; i++) {
      const opened = await measureExplorer(`Explorer button ${i + 1}`, undefined, i === 0);
      if (i === 0) {
        for (const state of ["minimized", "maximized"] as const) {
          const reused = await measureExplorer(`Explorer existing/${state}`, state, tabbedExplorer || state === "minimized");
          assert.equal(reused.handle, opened.handle, "restore/recenter the same matching Explorer window");
        }
        if (tabbedExplorer) {
          const selected = await measureExplorer("Explorer directory in an inactive tab", "inactive-tab");
          assert.notEqual(selected.handle, opened.handle, "open a background directory separately without selecting any existing tab");
        }
        await closeRetained();
      }
    }
  } finally { await closeRetained(); }

  for (const nested of [false, true]) {
    if (nested) {
      const activity = page.locator(".tool-activity:not([open]) > summary");
      if (await activity.count()) await activity.first().click();
      await page.getByRole("button", { name: `打开子会话：${task.description}`, exact: true }).click();
    }
    const container = nested ? page.getByRole("dialog", { name: "子代理会话", exact: true }) : page.locator(".composer-area").filter({ has: page.locator("#prompt") });
    const add = container.getByRole("button", { name: "添加附件", exact: true });
    for (let i = 0; i < 3; i++) {
      await page.bringToFront();
      const response = page.waitForResponse("**/api/attachments/pick?*");
      await measure(`${nested ? "child" : "main"} attachment button ${i + 1}`, "打开文件或文件夹", () => add.click(), async () => {
        assert.deepEqual(await (await response).json(), { items: [] });
        await add.waitFor();
        assert.equal(await add.isEnabled(), true);
      });
    }
  }
  assert.deepEqual(errors, []);
  console.log(`PASS: ${measurements.length} samples below 1000 ms, picker first-visibility and Explorer visible/centered geometry verified; max ${Math.max(...measurements.map((m) => m.ms))} ms.`);
} catch (error) {
  console.error("Native window acceptance failed:", error);
  throw error;
} finally {
  await browser?.close();
  await app?.close();
  await dialog.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
