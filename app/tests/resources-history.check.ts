import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import { defaultMaintenanceBudgets } from "../src/shared/maintenance.js";

const root = mkdtempSync(join(tmpdir(), "axiom-resource-history-")), pi = join(root, "shared");
const previous = process.env.PI_CODING_AGENT_DIR, previousShared = process.env.AXIOM_PI_DIR;
process.env.PI_CODING_AGENT_DIR = pi; process.env.AXIOM_PI_DIR = pi;
const directory = join(root, "pi/skills/history-fixture"), guide = join(directory, "SKILL.md");
const content = "---\nname: history-fixture\ndescription: history display regression\n---\nGuide";
for (const path of [directory, pi, join(root, "resources"), join(root, "maintenance")]) mkdirSync(path, { recursive: true });
writeFileSync(guide, content); writeFileSync(join(directory, "attachment.txt"), "attachment");
const job = { id: "historical-failure", running: false, message: "操作未完成", error: "请先停止本机 Agent、子任务及压缩，再修改资源。" };
const jobPath = join(root, "resources/job.json");
writeFileSync(jobPath, JSON.stringify({ job }));
writeFileSync(join(root, "maintenance/tasks.json"), JSON.stringify({ budgets: defaultMaintenanceBudgets, tasks: [{
  id: job.id, attemptId: "old-attempt", resource: "resources", label: "history-fixture", action: "remove", scope: "应用级", endpoint: "backend",
  status: "failed", phase: "checking", steps: ["checking", "removing", "validating"], completedSteps: 0,
  createdAt: 1, startedAt: 1, updatedAt: 2, finishedAt: 2, budgets: defaultMaintenanceBudgets, capabilities: { cancel: false, extend: false },
  error: { code: "operation", message: "操作未完成，请到来源页面核实安装结果。", phase: "checking" },
}] }));
const browser = await chromium.launch({ headless: true, executablePath: process.env.AXIOM_TEST_BROWSER });
const app = await startServer({ root, port: 0, dev: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
try {
  await page.goto(app.origin + "/resources.html");
  const history = page.locator("details.resources-job-history");
  await history.waitFor();
  assert.equal(await history.getAttribute("open"), null);
  assert.equal(await page.getByRole("alert").count(), 0, "neither old resource error nor old maintenance task is a current alert");
  await page.reload(); await history.waitFor();
  assert.equal(await history.getAttribute("open"), null);
  assert.equal(await page.getByRole("alert").count(), 0);
  await history.locator("summary").click();
  assert.match(await history.innerText(), /请先停止本机 Agent/);
  await history.getByRole("button", { name: "关闭上次资源操作失败提示" }).click();
  await page.reload();
  await page.getByRole("button", { name: "刷新目录", exact: true }).waitFor();
  assert.equal(await history.count(), 0);
  assert.deepEqual(JSON.parse(readFileSync(jobPath, "utf8")).job, job, "history display never erases server evidence");
  assert.equal(await page.getByRole("button", { name: "任务与下载设置", exact: true }).count(), 0);
  const legacy = page.locator(".resources-legacy-maintenance");
  await legacy.locator("summary").first().click();
  await legacy.getByRole("alert").filter({ hasText: "操作未完成，请到来源页面核实安装结果。" }).waitFor();
  assert.match(await legacy.innerText(), /具体资源未记录/, "legacy evidence is not misattributed to the selected resource");
  await legacy.locator("summary").first().click();
  assert.equal(JSON.parse(readFileSync(join(root, "maintenance/tasks.json"), "utf8")).tasks[0].id, job.id, "display does not erase durable maintenance evidence");
  await page.locator("nav.supplier-list button").filter({ hasText: "history-fixture" }).click();
  const editor = page.locator("#resource-content");
  await editor.fill("# missing frontmatter");
  await page.getByRole("button", { name: "保存技能内容", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "技能内容缺少有效名称或说明" }).waitFor();
  assert.equal(readFileSync(guide, "utf8"), content);
  assert.equal(await history.getAttribute("open"), null, "a new failure has its own collapsed history record");
  await editor.fill(content + "\nUpdated");
  await page.getByRole("button", { name: "保存技能内容", exact: true }).click();
  await page.getByText("配置已保存。", { exact: true }).waitFor();
  // Resource and maintenance scopes publish independently; wait for the successful task snapshot too.
  await page.getByRole("alert").waitFor({ state: "hidden" });
  assert.equal(await page.getByRole("alert").count(), 0);
  assert.equal(await history.getAttribute("open"), null, "older failures remain collapsed evidence, not current alerts");
  await page.getByRole("button", { name: "卸载资源", exact: true }).click();
  await page.getByRole("button", { name: "确认卸载", exact: true }).click();
  await page.getByText("已删除，资源列表已刷新。", { exact: true }).waitFor();
  assert.equal(existsSync(directory), false);
  assert.equal(await page.locator("nav.supplier-list button").filter({ hasText: "history-fixture" }).count(), 0);
  assert.equal(await page.getByRole("alert").count(), 0);
  assert.deepEqual(errors, []);
  console.log("PASS: persisted resource and maintenance failures do not reopen as alerts; legacy evidence remains locally inspectable without a public center; new failures alert, successful save and uninstall clear them.");
} finally {
  await browser.close(); await app.close();
  if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
  if (previousShared === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousShared;
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
