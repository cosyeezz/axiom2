// Real subscriptions and child windows, isolated data, touch emulation, no model calls.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Locator } from "playwright";
import { startServer } from "../src/server/index.js";
import { TaskRecords } from "../src/server/tasks/records.js";
import type { AgentViews } from "../src/server/agents/views.js";
import type { ChatMessage } from "../src/shared/agent.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";
import { tasksScope } from "../src/shared/tasks.js";

const root = mkdtempSync(join(tmpdir(), "axiom-task-layout-"));
const artifacts = resolve(process.env.AXIOM_TEST_ARTIFACTS || "test-results/task-layout");
mkdirSync(artifacts, { recursive: true });
const previousPi = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
mkdirSync(process.env.AXIOM_PI_DIR);
const app = await startServer({ root, port: 0, dev: !process.env.AXIOM_TEST_PRODUCTION });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, reducedMotion: "reduce" });
const errors: string[] = [], commands: { op: string; sessionId?: string }[] = [];
page.on("pageerror", error => errors.push(error.message));
page.on("websocket", socket => socket.on("framesent", ({ payload }) => {
  const frame = JSON.parse(String(payload)); if (frame.op) commands.push(frame);
}));
page.setDefaultTimeout(10000);
try {
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: root, authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const views = (app.agents as unknown as { views: AgentViews }).views;
  const longText = "手机端补充检查：" + "核对长路径、中文、英文及换行内容不会把摘要挤成第三行。\n".repeat(15);
  const put = (target: Scope, ...messages: ChatMessage[]) => { for (const message of messages) views.messageChanged(target, message); views.flush(target); };
  const seed = (target: Scope, taskId: string) => {
    const rows: [string, string, unknown, ChatMessage["status"], string][] = [
      ["append", "append", { taskId, summary: "补查手机端布局", text: longText }, "completed", "{}"],
      ["follow", "functions.append", { taskId, mode: "followUp", text: longText }, "failed", longText],
      ["read", "read_result", { taskId, resultId: "fixture" }, "completed", "{}"],
      ["stop", "functions.cancel_task", { taskId, reason: longText }, "completed", "{}"],
      ["stop-empty", "cancel_task", { taskId }, "completed", "{}"],
      ["cancelled", "append", { taskId, text: longText }, "cancelled", ""],
      ["running", "append", { taskId, text: longText }, "running", ""],
      ["pending", "delegate", { context: longText.repeat(30), tasks: [{ title: "检查待创建任务", task: longText }, { title: "核对长输入标题", task: longText }] }, "running", ""],
      ["unsynced", "functions.delegate", { tasks: [{ task: longText }] }, "completed", "{}"],
      ["failed", "delegate", { tasks: [{ task: longText }] }, "failed", longText],
    ];
    for (const [id, name, input, status, text] of rows) put(target,
      { id: `message-${id}`, role: "assistant", text: "", calls: [{ id, name, input: JSON.stringify(input) }] },
      { id: `tool-${id}`, role: "toolResult", toolCallId: id, status, text });
  };
  const records = new TaskRecords(app.store);
  const descriptions = ["打开布局验证子会话\n" + longText.repeat(2), longText, "已停止任务", "等待中的任务"];
  const background = "UI fixture\n当前任务:\n这仍然属于背景原文。";
  const { taskIds } = records.create(scope, "members", background, descriptions.map((task, i) => ({ ...(i === 0 ? { title: "验证子任务卡片" } : {}), task })), { provider: "fixture", id: "fixture", thinking: "off" });
  for (const [i, status] of ["completed", "failed", "cancelled", "queued"].entries()) app.store.db.prepare("UPDATE tasks SET status=?,error=? WHERE id=?").run(status, i === 1 ? longText : null, taskIds[i]);
  const childSessionId = String(app.store.db.prepare("SELECT sessionId FROM tasks WHERE id=?").get(taskIds[0])!.sessionId);
  const childScope = { workspaceId: workspace.id, sessionId: childSessionId };
  const initial = records.inputs(records.rows("WHERE id=?", taskIds[0])[0], "queued")[0];
  put(childScope, { id: "initial-task", role: "user", text: initial.body, inputIds: [initial.id] },
    { id: "later-append", role: "user", text: "后续追加要求保持在时间线", inputIds: ["later-input"] });
  const legacy = records.rows("WHERE id=?", taskIds[1])[0];
  app.store.db.prepare("UPDATE tasks SET context=NULL,initialInputId=NULL WHERE id=?").run(legacy.id);
  put({ workspaceId: scope.workspaceId, sessionId: legacy.sessionId }, { id: "legacy-input", role: "user", text: "历史背景和任务正文保留，不猜测分隔边界" });
  put(scope, { id: "members-message", role: "assistant", text: "", calls: [{ id: "members", name: "delegate", input: "{}" }] },
    { id: "tool-members", role: "toolResult", toolCallId: "members", status: "completed", text: JSON.stringify({ taskIds }) });
  app.agents.publish(tasksScope(scope), app.tasks.list(scope));
  seed(scope, taskIds[0]);
  seed(childScope, "historical-child-task");
  await page.addInitScript(value => sessionStorage.setItem("view", JSON.stringify(value)), scope);
  await page.goto(app.origin);
  assert.equal(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), true);
  const main = page.locator("#messages");
  const check = async (container: Locator, label: string) => {
    await container.locator('.task-operation[data-tool="append"]').first().waitFor();
    const metrics = await container.evaluate(el => {
      const helpers = { color(node: Element, variable: string) { const probe = document.createElement("span"); probe.style.color = `var(${variable})`; node.appendChild(probe); const value = getComputedStyle(probe).color; probe.remove(); return value; } };
      return {
        operations: [...el.querySelectorAll(".task-operation")].map(node => {
          const heading = node.querySelector(".task-operation-heading")!, target = node.querySelector(".task-operation-target"), summary = node.querySelector("summary")!, icon = node.querySelector(".task-operation-icon")!;
          return { tool: node.getAttribute("data-tool"), title: heading.querySelector("strong")!.textContent, preview: target?.textContent, status: node.getAttribute("data-status"), height: node.getBoundingClientRect().height, line: parseFloat(getComputedStyle(heading.querySelector("strong")!).lineHeight), heading: heading.getBoundingClientRect().height, target: target?.getBoundingClientRect().height ?? 0, children: summary.children.length, color: getComputedStyle(icon.querySelector("svg")!).color, muted: helpers.color(icon, "--meta"), danger: helpers.color(icon, "--danger-icon"), hiddenStatus: getComputedStyle(node.querySelector('.task-operation-status')!).clipPath, overflow: node.scrollWidth > node.clientWidth + 1 };
        }),
        pending: [...el.querySelectorAll(".delegation-pending-item")].map(node => ({ title: node.querySelector("p")!.textContent, height: node.getBoundingClientRect().height, line: parseFloat(getComputedStyle(node.querySelector("p")!).lineHeight), overflow: node.scrollWidth > node.clientWidth + 1 })),
        members: [...el.querySelectorAll(".subagent")].map(node => { const icon = node.querySelector(".agent-state")!; return { title: node.querySelector("strong")!.textContent, state: icon.getAttribute("data-state"), height: node.getBoundingClientRect().height, line: parseFloat(getComputedStyle(node.querySelector("strong")!).lineHeight), color: getComputedStyle(icon.querySelector("svg")!).color, muted: helpers.color(icon, "--meta"), danger: helpers.color(icon, "--danger-icon") }; }),
        rightSide: el.querySelectorAll(".task-batch-progress, .task-operation-action, .task-operation-chevron, .task-operation > details > summary > .task-operation-status").length,
        openIcons: [...el.querySelectorAll(".agent-open use")].map(node => node.getAttribute("href")),
      };
    });
    assert.equal(metrics.operations.length, 7, `${label}: all operation states`);
    assert.equal(metrics.pending.length, 4, `${label}: creation, unsynced and failure`);
    assert.equal(metrics.rightSide, 0, `${label}: no right-side status, counter or collapse arrow`);
    for (const box of metrics.operations) {
      const lines = box.preview ? 2 : 1;
      assert.ok(Math.abs(box.height - (Math.max(44, box.line * lines + 12) + 2)) <= 1, `${label}: operation ${lines} lines ${JSON.stringify(box)}`);
      assert.ok(Math.abs(box.heading - box.line * lines) <= 1 && Math.abs(box.target - (lines === 2 ? box.line : 0)) <= 1, `${label}: second line appears only with a preview`);
      assert.equal(box.title, label.startsWith("child") ? "关联子任务" : "验证子任务卡片");
      assert.equal(box.children, 2, `${label}: only existing icon and text`);
      assert.equal(box.hiddenStatus, "inset(50%)");
      assert.equal(box.muted, "rgb(138, 143, 152)", `${label}: neutral system gray, not process text color`);
      assert.equal(box.color, ["failed", "cancelled"].includes(box.status!) ? box.danger : box.muted, `${label}: icon status color`);
      assert.equal(box.overflow, false);
    }
    assert.equal(metrics.operations[0].preview, "补查手机端布局");
    assert.deepEqual(metrics.operations.filter(box => box.tool === "cancel_task").map(box => box.preview), [longText, undefined]);
    assert.ok(metrics.operations.filter(box => box.tool === "append").slice(1).every(box => box.preview === "补充任务"), "missing summaries never use the append body");
    assert.deepEqual(metrics.pending.map(box => box.title), ["检查待创建任务", "核对长输入标题", "子任务", "子任务"]);
    if (metrics.members.length) assert.deepEqual(metrics.members.map(box => box.title), ["验证子任务卡片", "子任务", "子任务", "子任务"]);
    for (const box of metrics.pending) { assert.ok(Math.abs(box.height - box.line) <= 1, `${label}: pending feedback stays single line ${JSON.stringify(box)}`); assert.equal(box.overflow, false); }
    for (const box of metrics.members) {
      assert.ok(Math.abs(box.height - Math.max(44, box.line + 12)) <= 1, `${label}: member single line`);
      assert.equal(box.color, ["failed", "stopped"].includes(box.state!) ? box.danger : box.muted, `${label}: member status color`);
    }
    assert.ok(metrics.openIcons.every(href => href === "#i-subagent-open"));
    console.log("PASS", label, metrics.operations.length, "operations", metrics.pending.length, "pending", metrics.members.length, "members");
  };
  for (const width of [320, 360, 390, 430, 820, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await check(main, `main-touch-${width}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(artifacts, "main-mobile.png") });
  // The baseline replaced the global original-view toggle with inline history.
  // This fixture has no compaction; do not restore an obsolete product control.
  assert.equal(await page.getByRole("button", { name: "原始会话", exact: true }).count(), 0);
  await page.locator(`[data-task-id="${taskIds[0]}"] > button`).click();
  const child = page.getByRole("dialog", { name: "子代理会话", exact: true });
  assert.equal(await child.locator(".subagent-dialog-heading strong").innerText(), "验证子任务卡片");
  assert.equal(await child.locator(".task-brief").count(), 1);
  const brief = child.getByRole("article", { name: "任务说明", exact: true });
  assert.deepEqual(await brief.locator("h3").allTextContents(), ["任务背景", "任务目标"]);
  assert.deepEqual(await brief.locator("p").allTextContents(), [background, descriptions[0]]);
  assert.equal(await brief.getAttribute("data-collapsed"), "true");
  assert.equal(await child.getByRole("article", { name: "用户消息", exact: true }).count(), 1, "initial input is represented once; appends remain visible");
  await child.getByText("后续追加要求保持在时间线", { exact: true }).waitFor();
  for (const width of [320, 360, 390, 430, 820, 1440]) { await page.setViewportSize({ width, height: 1000 }); await check(child, `child-touch-${width}`); }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(artifacts, "child-mobile.png") });
  await child.getByRole("button", { name: "任务说明", exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.matches("[data-task-brief]"));
  assert.equal(await brief.getAttribute("data-collapsed"), "false");
  const position = await child.locator(".thread").evaluate(el => el.scrollTop);
  const rows = Number(await child.locator(".virtual-timeline").getAttribute("data-total-rows"));
  put(childScope, { id: "late-progress", role: "assistant", text: "说明查看期间新增消息" });
  // While reading the brief, the new tail is legitimately outside the virtual window.
  await page.waitForFunction(count => Number(document.querySelector(".subagent-dialog .virtual-timeline")?.getAttribute("data-total-rows")) === count + 1, rows);
  assert.ok(Math.abs(await child.locator(".thread").evaluate(el => el.scrollTop) - position) < 2, "new messages do not pull brief navigation to the bottom");
  await page.screenshot({ path: join(artifacts, "child-brief-mobile.png") });
  await brief.getByRole("button", { name: "收起任务说明", exact: true }).click();
  assert.equal(await brief.getAttribute("data-collapsed"), "true");
  assert.equal(await child.getByRole("button", { name: "原始会话", exact: true }).count(), 0);
  assert.equal(await child.locator(".task-brief").count(), 1);
  await child.getByRole("button", { name: "关闭子代理会话，返回主对话", exact: true }).click();
  await page.locator(`[data-task-id="${legacy.id}"] > button`).click();
  await child.getByText("历史背景和任务正文保留，不猜测分隔边界", { exact: true }).waitFor();
  assert.equal(await child.locator(".task-brief").count(), 1);
  assert.deepEqual(await child.locator(".task-brief h3").allTextContents(), ["任务目标"]);
  await child.getByRole("button", { name: "关闭子代理会话，返回主对话", exact: true }).click();
  put(scope, { id: "final", role: "assistant", text: "布局检查结束", status: "completed", phase: "final_answer" });
  const aggregate = main.locator('[data-timeline-key^="live:final-process:"] > .tool-activity:not(.process-live)');
  await aggregate.waitFor();
  assert.equal(await aggregate.count(), 1, "one settled process card owns the existing operations");
  assert.equal(await aggregate.getAttribute("open"), null);
  assert.equal(await aggregate.getAttribute("data-status"), "completed");
  await aggregate.locator(":scope > summary").click();
  assert.equal(await aggregate.getAttribute("open"), "");
  await check(main, "main-folded-history-touch");
  const operation = main.locator('.task-operation[data-tool="append"]').first();
  await operation.locator("summary").first().click();
  await operation.locator(".task-call-detail").waitFor();
  await aggregate.locator(":scope > summary").click();
  assert.equal(await aggregate.getAttribute("open"), null);
  assert.equal(await main.locator(".task-call-detail").count(), 0);
  await aggregate.locator(":scope > summary").click();
  assert.equal(await aggregate.getAttribute("open"), "");
  await check(main, "main-reopened-history-touch");
  assert.equal(await main.locator(".task-call-detail").count(), 0);
  assert.equal(await page.locator("#i-subagent-open path").getAttribute("d"), "M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6m10 0l-9 9m3-9h6v6");
  assert.ok(commands.some(command => command.op === "agent.history.index" && command.sessionId === scope.sessionId));
  assert.ok(commands.some(command => command.op === "agent.history.index" && command.sessionId === childScope.sessionId));
  assert.ok(!commands.some(command => ["agent.original", "prompt", "agent.resume", "task.create", "task.append", "task.cancel"].includes(command.op)), "viewing existing cards only reads the current history contract, never executes tasks");
  assert.deepEqual(errors, []);
  console.log("PASS: touch main/child/inline-history, task brief and legacy input, long multiline inputs, waiting/failed/unsynced delegation, gray/red icons, W14, no counts or right-side status.");
} catch (error) {
  await page.screenshot({ path: join(artifacts, "failure.png") }).catch(() => {});
  throw error;
} finally {
  await browser.close(); await app.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
