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
const errors: string[] = [];
page.on("pageerror", error => errors.push(error.message));
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
      ["append", "append", { taskId, text: longText }, "completed", "{}"],
      ["follow", "functions.append", { taskId, mode: "followUp", text: longText }, "failed", longText],
      ["read", "read_result", { taskId, resultId: "fixture" }, "completed", "{}"],
      ["stop", "functions.cancel_task", { taskId, reason: longText }, "completed", "{}"],
      ["cancelled", "append", { taskId, text: longText }, "cancelled", ""],
      ["running", "append", { taskId, text: longText }, "running", ""],
      ["pending", "delegate", { tasks: [{ task: longText }, { task: longText }] }, "running", ""],
      ["unsynced", "functions.delegate", { tasks: [{ task: longText }] }, "completed", "{}"],
      ["failed", "delegate", { tasks: [{ task: longText }] }, "failed", longText],
    ];
    for (const [id, name, input, status, text] of rows) put(target,
      { id: `message-${id}`, role: "assistant", text: "", calls: [{ id, name, input: JSON.stringify(input) }] },
      { id: `tool-${id}`, role: "toolResult", toolCallId: id, status, text });
  };
  const records = new TaskRecords(app.store);
  const descriptions = ["打开布局验证子会话", longText, "已停止任务", "等待中的任务"];
  const { taskIds } = records.create(scope, "members", "UI fixture", descriptions.map(task => ({ task, role: "" })), { provider: "fixture", id: "fixture", thinking: "off" });
  for (const [i, status] of ["completed", "failed", "cancelled", "queued"].entries()) app.store.db.prepare("UPDATE tasks SET status=?,error=? WHERE id=?").run(status, i === 1 ? longText : null, taskIds[i]);
  const childSessionId = String(app.store.db.prepare("SELECT sessionId FROM tasks WHERE id=?").get(taskIds[0])!.sessionId);
  const childScope = { workspaceId: workspace.id, sessionId: childSessionId };
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
          const heading = node.querySelector(".task-operation-heading")!, target = node.querySelector(".task-operation-target")!, summary = node.querySelector("summary")!, icon = node.querySelector(".task-operation-icon")!;
          return { status: node.getAttribute("data-status"), height: node.getBoundingClientRect().height, line: parseFloat(getComputedStyle(target).lineHeight), heading: heading.getBoundingClientRect().height, target: target.getBoundingClientRect().height, children: summary.children.length, color: getComputedStyle(icon).color, muted: helpers.color(icon, "--muted"), danger: helpers.color(icon, "--danger-icon"), hiddenStatus: getComputedStyle(node.querySelector('[role="status"]')!).clipPath, overflow: node.scrollWidth > node.clientWidth + 1 };
        }),
        pending: [...el.querySelectorAll(".delegation-pending-item")].map(node => ({ height: node.getBoundingClientRect().height, line: parseFloat(getComputedStyle(node.querySelector("p")!).lineHeight), overflow: node.scrollWidth > node.clientWidth + 1 })),
        members: [...el.querySelectorAll(".subagent")].map(node => { const icon = node.querySelector(".agent-state")!; return { state: icon.getAttribute("data-state"), height: node.getBoundingClientRect().height, line: parseFloat(getComputedStyle(node.querySelector("strong")!).lineHeight), color: getComputedStyle(icon).color, muted: helpers.color(icon, "--muted"), danger: helpers.color(icon, "--danger-icon") }; }),
        rightSide: el.querySelectorAll(".task-batch-progress, .task-operation-action, .task-operation-chevron, .task-operation > details > summary > .task-operation-status").length,
        openIcons: [...el.querySelectorAll(".agent-open use")].map(node => node.getAttribute("href")),
      };
    });
    assert.equal(metrics.operations.length, 6, `${label}: all operation states`);
    assert.equal(metrics.pending.length, 4, `${label}: creation, unsynced and failure`);
    assert.equal(metrics.rightSide, 0, `${label}: no right-side status, counter or collapse arrow`);
    for (const box of metrics.operations) {
      assert.ok(Math.abs(box.height - (box.line * 2 + 14)) <= 1, `${label}: operation two lines ${JSON.stringify(box)}`);
      assert.ok(Math.abs(box.heading - box.line * 2) <= 1 && Math.abs(box.target - box.line) <= 1, `${label}: title + one preview line`);
      assert.equal(box.children, 2, `${label}: only left icon and two-line text`);
      assert.equal(box.hiddenStatus, "inset(50%)");
      assert.equal(box.color, ["failed", "cancelled"].includes(box.status!) ? box.danger : box.muted, `${label}: icon status color`);
      assert.equal(box.overflow, false);
    }
    for (const box of metrics.pending) { assert.ok(Math.abs(box.height - box.line * 2) <= 1, `${label}: pending feedback two lines ${JSON.stringify(box)}`); assert.equal(box.overflow, false); }
    for (const box of metrics.members) {
      assert.ok(Math.abs(box.height - (box.line * 2 + 12)) <= 1, `${label}: member two lines`);
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
  await main.screenshot({ path: join(artifacts, "main-mobile.png") });
  const original = page.getByRole("button", { name: "原始会话", exact: true });
  await original.click();
  await page.getByText("正在查看原始会话", { exact: true }).waitFor();
  await check(main, "main-original-touch");
  await original.click();
  await page.locator(`[data-task-id="${taskIds[0]}"] > button`).click();
  const child = page.getByRole("dialog", { name: "子代理会话", exact: true });
  for (const width of [320, 360, 390, 430, 820, 1440]) { await page.setViewportSize({ width, height: 1000 }); await check(child, `child-touch-${width}`); }
  await page.setViewportSize({ width: 390, height: 844 });
  await child.locator(".thread-content").screenshot({ path: join(artifacts, "child-mobile.png") });
  await child.getByRole("button", { name: "原始会话", exact: true }).click();
  await child.getByText("正在查看原始会话", { exact: true }).waitFor();
  await check(child, "child-original-touch");
  await child.getByRole("button", { name: "关闭子代理会话，返回主对话", exact: true }).click();
  put(scope, { id: "final", role: "assistant", text: "布局检查结束", status: "completed", phase: "final_answer" });
  const aggregate = main.locator(":scope > .tool-activity:not(.process-live)");
  await aggregate.locator(":scope > summary").click();
  await check(main, "main-folded-history-touch");
  const operation = main.locator('.task-operation[data-tool="append"]').first();
  await operation.locator("summary").first().click();
  await operation.locator(".task-call-detail").waitFor();
  await aggregate.locator(":scope > summary").click();
  await aggregate.locator(":scope > summary").click();
  await check(main, "main-reopened-history-touch");
  assert.equal(await main.locator(".task-call-detail").count(), 0);
  assert.equal(await page.locator("#i-subagent-open path").getAttribute("d"), "M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6m10 0l-9 9m3-9h6v6");
  assert.deepEqual(errors, []);
  console.log("PASS: touch main/child/original/history, long multiline inputs, waiting/failed/unsynced delegation, gray/red icons, W14, no counts or right-side status.");
} catch (error) {
  await page.screenshot({ path: join(artifacts, "failure.png") }).catch(() => {});
  throw error;
} finally {
  await browser.close(); await app.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
