import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import type { AgentViews } from "../src/server/agents/views.js";
import type { ChatMessage, RunPhase } from "../src/shared/agent.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-process-continuity-"));
mkdirSync(join(root, "project")); mkdirSync(join(root, "pi"));
const previousPi = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi");
let app: Awaited<ReturnType<typeof startServer>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  app = await startServer({ root: join(root, "data"), port: 0, dev: true });
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: join(root, "project"), authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const views = (app.agents as unknown as { views: AgentViews }).views;
  const publish = (...messages: ChatMessage[]) => { for (const message of messages) views.messageChanged(scope, message); views.flush(scope); };
  const phase = (next: RunPhase, status = "running", runId = "run") => {
    app!.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt,phase) VALUES(?,?,?,'{}',1,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,phase=excluded.phase").run(runId, session.id, status, next);
    views.changed(scope);
  };
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true, reducedMotion: "reduce" });
  page.setDefaultTimeout(10000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript("window.__name = value => value;");
  await page.addInitScript(value => sessionStorage.setItem("view", JSON.stringify(value)), scope);
  await page.goto(app.origin);
  const requests = page.locator("#messages .process-requesting");
  // Optimistic transport work precedes a server run; queued and unsent work use
  // the same vocabulary, but a queued steering message never adds a second row.
  for (const queued of [false, true]) {
    const id = `pending-${queued}`;
    // Give reconciliation a real committed receipt/queue entry. An invented
    // not_found receipt correctly becomes uncertain and is not a model request.
    app.store.db.prepare("INSERT INTO external_requests(id,hash,state,response,scope) VALUES(?,?,'committed',?,?)").run(id, "fixture", JSON.stringify({ inputId: id }), JSON.stringify([scope.workspaceId, scope.sessionId]));
    views.queues.set(session.id, [{ id, text: "检查环境", mode: "followUp" }]);
    await page.evaluate(async ({ scope, queued, id }) => {
      const path = "/chat/optimistic.ts";
      (await import(/* @vite-ignore */ path)).optimisticStart(scope, id, { text: "检查环境", attachment: null }, queued);
    }, { scope, queued, id });
    await requests.getByText("请求中", { exact: true }).waitFor();
    assert.equal(await requests.count(), 1);
    await page.evaluate(async ({ scope, id }) => {
      const path = "/chat/optimistic.ts";
      const optimistic = await import(/* @vite-ignore */ path);
      optimistic.optimisticState(scope, id, "failed");
      optimistic.clearOptimistic(scope);
    }, { scope, id });
    await requests.waitFor({ state: "detached" });
    views.queues.delete(session.id);
  }
  publish({ id: "user", role: "user", text: "检查环境", runId: "run" });
  phase("initializing", "starting");
  await requests.getByText("请求中", { exact: true }).waitFor();
  const initialNode = await requests.elementHandle();
  for (const next of ["initializing", "requesting", "generating", "retry_wait", "retrying", "compacting"] as RunPhase[]) {
    phase(next);
    await requests.getByText("请求中", { exact: true }).waitFor();
    assert.ok(await initialNode!.evaluate(node => node.isConnected), `initial row survives ${next}`);
    assert.equal(await requests.count(), 1);
  }
  await page.reload();
  await requests.getByText("请求中", { exact: true }).waitFor();
  const thought: ChatMessage = { id: "thought", role: "assistant", runId: "run", text: "", thinking: "核对配置", thinkingActive: true, streaming: true, status: "running" };
  const tool: ChatMessage = { id: "tool", role: "assistant", runId: "run", text: "", calls: [{ id: "read", name: "read", input: '{"path":"config.json"}' }], streaming: true, status: "running" };
  const groups = page.locator("#messages .timeline-row > .process-live");
  const title = groups.locator(":scope > summary .activity-title");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 1440) { phase("generating"); publish(thought); }
    else publish({ id: "next-thought", role: "assistant", runId: "run", text: "", thinking: "继续核对", thinkingActive: true, streaming: true, status: "running" });
    await title.getByText("正在思考", { exact: true }).waitFor();
    await page.evaluate(() => {
      const row = document.querySelector("#messages .process-live[data-status='running']")!;
      const summary = row.querySelector(":scope > summary")!;
      const title = summary.querySelector(".activity-title")!;
      const state = (window as any).continuity = { row, summary, title, samples: [] as any[], stopped: false, removed: false, observer: null as MutationObserver | null };
      const observer = new MutationObserver(() => { if (!row.isConnected || !summary.isConnected || !title.isConnected) state.removed = true; });
      observer.observe(document.querySelector("#messages")!, { childList: true, subtree: true });
      state.observer = observer;
      const sample = () => {
        const live = [...document.querySelectorAll("#messages .process-requesting, #messages .process-live[data-status='running']")];
        const rect = summary.getBoundingClientRect(), label = title.getBoundingClientRect();
        state.samples.push({ count: live.length, text: title.textContent?.trim(), height: rect.height, x: label.x - rect.x, y: label.y - rect.y });
        if (!state.stopped) requestAnimationFrame(sample);
      };
      sample();
    });
    // Keep the run alive while facts settle, before the next request arrives.
    publish({ ...thought, thinkingActive: false, streaming: false, status: "completed" }, ...(width === 390 ? [{ id: "next-thought", role: "assistant" as const, runId: "run", text: "", thinking: "继续核对", status: "completed" as const }] : []));
    await title.getByText("正在思考", { exact: true }).waitFor();
    for (const next of ["requesting", "generating"] as RunPhase[]) {
      phase(next); await title.getByText("正在思考", { exact: true }).waitFor();
    }
    if (width === 1440) publish(tool, { id: "tool-read", role: "toolResult", toolCallId: "read", text: "", status: "running" });
    else publish({ id: "next-tool", role: "assistant", runId: "run", text: "", calls: [{ id: "read-next", name: "read", input: "{}" }], status: "running", streaming: true });
    phase("executing_tools");
    await title.getByText("调用工具", { exact: true }).waitFor();
    publish({ ...tool, status: "completed", streaming: false }, { id: "tool-read", role: "toolResult", toolCallId: "read", text: "{}", status: "completed" }, ...(width === 390 ? [{ id: "next-tool", role: "assistant" as const, runId: "run", text: "", calls: [{ id: "read-next", name: "read", input: "{}" }], status: "completed" as const }, { id: "tool-read-next", role: "toolResult" as const, toolCallId: "read-next", text: "{}", status: "completed" as const }] : []));
    await title.getByText("调用工具", { exact: true }).waitFor();
    for (const next of ["requesting", "generating", "retry_wait", "retrying"] as RunPhase[]) {
      phase(next); await title.getByText("调用工具", { exact: true }).waitFor();
      assert.equal(await title.getAttribute("data-thinking"), null);
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    }
    // New actual thinking beats an earlier tool even if its result is stale-running.
    publish({ id: `last-thought-${width}`, role: "assistant", runId: "run", text: "", thinking: "整理结果", status: "running", streaming: true, thinkingActive: true },
      { id: "tool-read", role: "toolResult", toolCallId: "read", text: "", status: "running" });
    await title.getByText("正在思考", { exact: true }).waitFor();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const measured = await page.evaluate(() => {
      const state = (window as any).continuity; state.stopped = true; state.observer.disconnect();
      return { removed: state.removed, connected: state.row.isConnected && state.summary.isConnected && state.title.isConnected, samples: state.samples };
    });
    assert.equal(measured.removed, false, "phase changes never unmount the row, summary or title");
    assert.equal(measured.connected, true);
    assert.ok(measured.samples.length >= 8);
    assert.ok(measured.samples.every((s: any) => s.count === 1 && ["正在思考", "调用工具"].includes(s.text)), JSON.stringify(measured.samples));
    for (const key of ["height", "x", "y"]) {
      const values = measured.samples.map((s: any) => s[key]);
      assert.ok(Math.max(...values) - Math.min(...values) <= 1, `${width}: ${key} remains stable: ${JSON.stringify(values)}`);
    }
  }
  phase("settling", "completed");
  publish({ id: "final", role: "assistant", runId: "run", text: "配置检查完成", phase: "final_answer", status: "completed", streaming: false });
  await page.getByText("配置检查完成", { exact: true }).waitFor();
  await page.locator(".activity-status-completed").first().waitFor({ state: "attached" });
  assert.equal(await requests.count(), 0);
  // A real new user boundary resets the activity instead of borrowing old tools.
  publish({ id: "user-next", role: "user", text: "新的检查", runId: "new-run" });
  phase("initializing", "starting", "new-run");
  await requests.getByText("请求中", { exact: true }).waitFor();
  for (const status of ["stopping", "failed", "cancelled"]) {
    phase("requesting", status, "new-run"); await requests.waitFor({ state: "detached" });
    phase("initializing", "starting", "new-run"); await requests.getByText("请求中", { exact: true }).waitFor();
  }
  assert.deepEqual(errors, []);
  console.log("PASS initial optimistic/queued/initializing/empty generating/reload; 1440+390 chronological thinking/tool/request continuity, DOM identity and per-frame layout; delivery, new-turn reset and terminal cleanup");
} finally {
  await browser?.close(); await app?.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
