// Real Composer/AgentThread/SteeringQueue, isolated data, intercepted prompts; no model calls.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type WebSocketRoute } from "playwright";
import { startServer } from "../src/server/index.js";
import { agentScope, emptyAgent } from "../src/shared/agent.js";
import type { AgentViews } from "../src/server/agents/views.js";
import type { Command, Session, Workspace } from "../src/shared/protocol.js";

type LocalTrace = { requestId: string; visible: boolean; status: string; requests: number; draft: string };
const root = mkdtempSync(join(tmpdir(), "axiom-submission-optimistic-")), previousPi = process.env.AXIOM_PI_DIR;
mkdirSync(join(root, "pi"));
process.env.AXIOM_PI_DIR = join(root, "pi");
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  app = await startServer({ root: join(root, "data"), port: 0, dev: true });
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const service = app;
  const workspace = service.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: root, authorized: true } }) as Workspace;
  const views = (service.agents as unknown as { views: AgentViews }).views;
  const scopes = [0, 1].map(i => {
    const session = service.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
    const scope = { workspaceId: workspace.id, sessionId: session.id };
    views.messageChanged(scope, { id: `history-${i}`, role: "assistant", text: `Optimistic fixture history ${i}` });
    views.flush(scope);
    return scope;
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [], sends: Command[] = [];
  page.on("pageerror", error => errors.push(error.message));
  async function noUserFooters() {
    const extras = await page.locator('#messages article[aria-label="用户消息"]').evaluateAll(rows => rows.flatMap(row => {
      const bubble = row.querySelector(".user-text")!;
      return [...row.querySelectorAll("*")].filter(el => !el.contains(bubble) && !bubble.contains(el)).map(el => el.outerHTML);
    }));
    assert.deepEqual(extras, [], "every local/formal user row contains only its bubble, never a status/error/recovery footer");
  }
  async function dispatched(count: number) {
    const deadline = Date.now() + 3000;
    while (sends.length < count && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(sends.length, count);
  }
  await page.route("**/@vite/client", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace("async function handleMessage(payload) {", "async function handleMessage(payload) { return;") });
  });
  await page.addInitScript(scope => sessionStorage.setItem("view", JSON.stringify(scope)), scopes[0]);
  const traceLocalSubmission = () => {
    (window as any).localSubmissionTrace = [];
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      if (typeof data === "string") {
        const command = JSON.parse(data);
        if (command.op === "prompt") {
          const selector = command.params.mode === "steer" ? ".steering-queue-item" : '#messages article[aria-label="用户消息"]';
          const item = [...document.querySelectorAll<HTMLElement>(selector)].find(el => el.textContent?.includes(command.params.text));
          const bounds = item?.getBoundingClientRect();
          (window as any).localSubmissionTrace.push({ requestId: command.requestId,
            visible: !!item && !!bounds && bounds.height > 0 && bounds.top < innerHeight && bounds.bottom > 0 && getComputedStyle(item).visibility !== "hidden",
            status: item?.querySelector('[role="status"]')?.textContent ?? "",
            requests: document.querySelectorAll("#messages .process-requesting").length,
            draft: (document.querySelector("#prompt") as HTMLTextAreaElement).value,
          });
        }
      }
      return send.call(this, data);
    };
  };
  const selection = { provider: "fixture", id: "fixture", thinking: "off" };
  let socket: WebSocketRoute, seq = 0;
  const publish = (scope: typeof scopes[number], queue: { id: string; text: string; mode: "steer" }[] = []) => socket.send(JSON.stringify({
    type: "snapshot", scope: agentScope(scope), streamId: "optimistic-fixture", seq: ++seq,
    data: { ...emptyAgent, selection, queue, run: scope === scopes[1]
      ? { id: "fixture-active", sessionId: scope.sessionId, status: "running", selection, startedAt: Date.now() } : null },
  }));
  await page.routeWebSocket("**/ws", route => {
    socket = route;
    const server = route.connectToServer();
    route.onMessage(raw => {
      const command = JSON.parse(raw.toString()) as Command;
      if (command.op === "prompt") sends.push(command); // Deliberately withhold every prompt receipt.
      else if (command.op === "agent.inputs") route.send(JSON.stringify({ type: "receipt", requestId: command.requestId, ok: true, data: [] }));
      else if (command.op === "agent.editable") route.send(JSON.stringify({ type: "receipt", requestId: command.requestId, ok: false,
        error: { code: "TEST_EDIT_FAILED", message: "fixture edit failure outside message" } }));
      else if (command.op === "subscribe" && scopes.some(scope => agentScope(scope) === command.params?.scope)) {
        publish(scopes.find(scope => agentScope(scope) === command.params?.scope)!);
        route.send(JSON.stringify({ type: "receipt", requestId: command.requestId, ok: true, data: {} }));
      } else server.send(raw);
    });
    server.onMessage(raw => {
      const message = JSON.parse(raw.toString());
      if (message.type === "snapshot" && scopes.some(scope => agentScope(scope) === message.scope)) return;
      if (message.type === "snapshot" && message.scope === "configuration") {
        // An explicit session choice remains sendable while advisory discovery
        // is unavailable. Configuration errors must not disable the Composer.
        message.data.available = [];
        message.data.error = "fixture model directory unavailable";
      }
      route.send(JSON.stringify(message));
    });
  });
  await page.goto(service.origin);
  // Install after Playwright's WebSocket routing shim, which replaces the native
  // constructor during initialization. Existing sockets use this same prototype.
  await page.evaluate(traceLocalSubmission);
  for (const [i, scope] of scopes.entries()) {
    if (i) await page.locator(`.history-row[data-session-id="${scope.sessionId}"] .history-item`).click();
    await page.getByText(`Optimistic fixture history ${i}`, { exact: true }).waitFor();
    const queued = i === 1, text = queued ? "local active queue before backend receipt" : "local idle message before backend receipt";
    await page.locator("#prompt").fill(text);
    if (queued) await page.locator("#prompt").press("Enter");
    else await page.locator("button.send").click();
    const local = queued ? page.locator(".steering-queue-item").filter({ hasText: text }) : page.locator("#messages .user-text").filter({ hasText: text });
    await local.waitFor({ state: "visible" });
    assert.equal(await page.locator("#prompt").inputValue(), "", "local submission clears only the captured draft immediately");
    const status = queued ? "正在排队…" : "";
    if (queued) await page.getByRole("status").filter({ hasText: status }).waitFor();
    else {
      await page.locator(".process-requesting").getByText("请求中", { exact: true }).waitFor();
      assert.equal(await page.locator(".process-requesting").count(), 1, "local submission immediately owns one request indicator");
      assert.equal(await page.getByText(/正在发送|已受理，等待进入会话/).count(), 0);
    }
    await noUserFooters();
    await page.waitForFunction(count => (window as any).localSubmissionTrace.length === count, i + 1, { timeout: 5000 }).catch(async error => {
      assert.fail(`${error}\n${JSON.stringify({ sends: sends.length, errors, trace: await page.evaluate(() => (window as any).localSubmissionTrace) })}`);
    });
    await dispatched(i + 1);
    const command = sends[i], trace = await page.evaluate(index => (window as any).localSubmissionTrace[index], i) as LocalTrace;
    assert.deepEqual(trace, { requestId: command.requestId, visible: true, status, requests: queued ? 0 : 1, draft: "" }, "bubble/queue and the single process indicator precede prompt socket.send");
    assert.equal(command.sessionId, scope.sessionId);
    assert.equal(command.params?.mode, queued ? "steer" : undefined);
    if (queued) assert.equal(await page.locator("#messages .user-text").filter({ hasText: text }).count(), 0, "active submission belongs only in the queue until consumed");
    if (!queued) await page.locator("#prompt").fill("typing after immediate feedback");
    // Only now acknowledge admission. The visible UI above existed without any reply.
    socket!.send(JSON.stringify({ type: "receipt", requestId: command.requestId, ok: true,
      data: queued ? { inputId: command.requestId } : { runId: command.requestId } }));
    if (queued) {
      publish(scope, [{ id: command.requestId, text, mode: "steer" }]);
      await page.waitForFunction(() => document.querySelector(".steering-queue-item [role=status]") === null);
      assert.equal(await local.count(), 1, "server queue snapshot merges with its local placeholder instead of duplicating it");
    } else {
      await page.waitForFunction(() => !(document.querySelector("button.send") as HTMLButtonElement).disabled);
      assert.equal(await page.locator(".process-requesting").count(), 1, "accepted keeps the same request indicator, not a second message status");
      assert.equal(await page.getByText(/正在发送|已受理，等待进入会话/).count(), 0);
      await noUserFooters();
    }
    views.messageChanged(scope, { id: `formal-${command.requestId}`, role: "user", text, inputIds: [command.requestId] });
    views.flush(scope);
    if (queued) publish(scope);
    const formal = page.locator("#messages .user-text").filter({ hasText: text });
    await formal.waitFor({ state: "visible" });
    await page.waitForFunction(marker => [...document.querySelectorAll("#messages .user-text")].filter(el => el.textContent?.includes(marker)).length === 1, text);
    assert.equal(await formal.count(), 1, "formal user input replaces the local placeholder exactly once");
    if (queued) await page.waitForFunction(() => !document.querySelector(".steering-queue"));
    await noUserFooters();
    if (!queued) {
      await formal.getByRole("button", { name: "修改并重新发送", exact: true }).click({ force: true });
      await page.locator(".composer-foot").getByText("fixture edit failure outside message", { exact: true }).waitFor();
      await noUserFooters();
    }
    console.log(`PASS ${queued ? "active queue" : "idle message"}: immediate single process indicator; no user footer; authoritative snapshots reconcile without duplicates`);
  }
  await page.locator(`.history-row[data-session-id="${scopes[0].sessionId}"] .history-item`).click();
  await page.getByText("Optimistic fixture history 0", { exact: true }).waitFor();
  for (const outcome of ["failed", "uncertain"] as const) {
    const text = `original ${outcome} submission`, newer = `new typing during ${outcome}`;
    await page.locator("#prompt").fill(text);
    const before = sends.length;
    await page.locator("button.send").click();
    await dispatched(before + 1);
    const command = sends.at(-1)!;
    assert.equal(command.params?.text, text, "each exceptional submission captures exactly the intended original text");
    await page.locator(".process-requesting").getByText("请求中", { exact: true }).waitFor();
    assert.equal(await page.locator(".process-requesting").count(), 1);
    await noUserFooters();
    await page.locator("#prompt").fill(newer);
    socket!.send(JSON.stringify({ type: "receipt", requestId: command.requestId, ok: false,
      error: { code: outcome === "uncertain" ? "UNCERTAIN" : "TEST_REJECTED", message: `fixture ${outcome} reason` } }));
    const feedback = page.locator(".composer-area .submission-feedback");
    await feedback.getByRole(outcome === "failed" ? "alert" : "status").waitFor();
    await page.waitForFunction(() => !document.querySelector(".process-requesting"));
    assert.equal(await page.locator("#prompt").inputValue(), newer);
    assert.equal(await page.locator("#messages .user-text").filter({ hasText: text }).count(), 1, "exceptional outcome retains original text without a footer");
    if (outcome === "failed") assert.match(await feedback.innerText(), /fixture failed reason.*原消息已保留/s);
    await noUserFooters();
    const restore = feedback.getByRole("button", { name: "恢复编辑", exact: true });
    await restore.click();
    assert.equal(await page.getByRole("dialog").count(), 0, "one click restores editing without a confirmation dialog");
    if (outcome === "uncertain") await page.locator(".composer-foot").getByText(/原消息已恢复编辑，尚未发送/).waitFor();
    await page.waitForFunction(expected => (document.querySelector("#prompt") as HTMLTextAreaElement).value === expected, `${text}\n\n${newer}`, { timeout: 5000 }).catch(async error => {
      assert.fail(`${error}\n${JSON.stringify({ outcome, expected: `${text}\n\n${newer}`, actual: await page.locator("#prompt").inputValue(), feedback: await feedback.allTextContents(), sends: sends.length, errors, composer: await page.locator(".composer-area").innerText() })}`);
    });
    assert.equal(await feedback.count(), 0);
    // Recovery deliberately focuses on the next animation frame. Settle that
    // focus before the following scenario starts another Playwright fill.
    await page.waitForFunction(() => document.activeElement === document.querySelector("#prompt"));
    assert.deepEqual(await page.locator("#prompt").evaluate((input: HTMLTextAreaElement) => [input.selectionStart, input.selectionEnd]), [0, 0]);
    assert.equal(sends.length, before + 1, "recovery only restores editing and never resends");
    await noUserFooters();
    console.log(`PASS ${outcome}: no user footer; feedback/recovery stays in composer; original and new typing preserved without replay`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close(); await app?.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
