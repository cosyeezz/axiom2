// Presentation-only regression: render the real TaskState with product CSS.
// Run: npm exec tsx tests/task-spinner.check.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";
import { TaskState } from "../src/client/tasks/TaskCards.js";
import { defaultBudgets, type Task, type TaskStatus } from "../src/shared/tasks.js";

const task: Task = {
  id: "spinner", workspaceId: "workspace", parentSessionId: "parent",
  sessionId: "child", anchor: "message", description: "检查子任务",
  status: "running", runId: "run", createdAt: 0, budgets: defaultBudgets,
  results: [], error: null,
};
const statuses: TaskStatus[] = ["queued", "starting", "running", "stopping", "completed", "failed", "cancelled", "interrupted"];
const css = ["tokens", "workbench"].map((name) => readFileSync(new URL(`../src/client/styles/${name}.css`, import.meta.url), "utf8")).join("\n");
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const page = await browser.newPage();
  await page.setContent(`<style>${css}</style>${statuses.map((status) => `<button class="subagent" id="${status}">${renderToStaticMarkup(createElement(TaskState, { task: { ...task, status } }))}</button>`).join("")}`);
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    await page.emulateMedia({ reducedMotion });
    for (const status of statuses) {
      const active = ["queued", "starting", "running", "stopping"].includes(status);
      const path = page.locator(`#${status} path`);
      const animation = await path.evaluate((node) => {
        const style = getComputedStyle(node);
        return { name: style.animationName, duration: style.animationDuration, iterations: style.animationIterationCount };
      });
      assert.equal(animation.name, active ? "run-spin" : "none", `${status}, ${reducedMotion}`);
      if (active) {
        assert.equal(animation.duration, reducedMotion === "reduce" ? "2.8s" : "1.4s");
        assert.equal(animation.iterations, "infinite");
        const before = await path.evaluate((node) => getComputedStyle(node).transform);
        await page.waitForTimeout(120);
        assert.notEqual(await path.evaluate((node) => getComputedStyle(node).transform), before, "arc actually rotates");
      }
      assert.equal(await page.locator(`#${status} svg`).evaluate((node) => getComputedStyle(node).transform), "none", "background stays still");
      assert.equal(await page.locator(`#${status} .agent-state-label`).evaluate((node) => getComputedStyle(node).transform), "none", "label stays still");
    }
  }
  await page.locator("#running .agent-state").evaluate((node) => { node.setAttribute("data-state", "completed"); });
  assert.equal(await page.locator("#running path").evaluate((node) => getComputedStyle(node).animationName), "none", "stops on state transition");
  console.log("PASS: task arcs rotate in normal/reduced motion; terminal states, backgrounds and labels stay still; state transition stops animation.");
} finally {
  await browser.close();
}
