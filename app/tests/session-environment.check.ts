import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import { memoryDirectory } from "../src/server/memory-files.js";
import type { AgentInfo } from "../src/shared/agent.js";
import type { Command, Scope, Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-environment-"));
const app = await startServer({ root: join(root, "data"), port: 0 });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const project = join(root, "project");
  mkdirSync(project);
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const create = (title: string) => {
    const session = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id, params: {} }) as Session;
    app.store.execute({ requestId: crypto.randomUUID(), op: "session.rename", workspaceId: workspace.id, sessionId: session.id, params: { title } });
    return { ...session, title };
  };
  const a = create("环境 A"), b = create("环境 B"), legacy = create("历史环境"), fresh = create("未初始化环境"), empty = create("空提示词环境");
  const scope = (session: Session): Scope => ({ workspaceId: workspace.id, sessionId: session.id });
  const environment = (systemPrompt?: string): NonNullable<AgentInfo["environment"]> => ({
    cwd: project, tools: ["read", "write", "powershell"], skills: ["fixture-skill"], extensions: 2,
    warnings: ["测试环境警告"], ...(systemPrompt === undefined ? {} : { systemPrompt }),
  });
  const save = (session: Session, value: NonNullable<AgentInfo["environment"]>) => {
    app.store.db.prepare("INSERT INTO agent_sessions(sessionId,environment) VALUES(?,?) ON CONFLICT(sessionId) DO UPDATE SET environment=excluded.environment")
      .run(session.id, JSON.stringify(value));
  };
  // Fixture text travels through the real persisted snapshot and WebSocket subscription.
  // Markup must remain literal text, not become executable HTML or Markdown.
  const promptA = "A 的实际系统提示词\n  保留缩进与换行。\n<script>window.__environmentInjected = true</script>\n<img src=x onerror=alert(1)>\n**不是 Markdown**\n"
    + "long-unbroken-system-prompt-".repeat(200) + "\n" + "完整尾部内容\n".repeat(100) + "A-END";
  const promptB = "B 的独立系统提示词\n仅属于环境 B。";
  save(a, environment(promptA));
  save(b, environment(promptB));
  save(legacy, environment());
  save(empty, environment(""));
  assert.equal(app.agents.info(scope(a)).environment?.systemPrompt, promptA);
  assert.equal(Object.hasOwn(app.agents.info(scope(legacy)).environment!, "systemPrompt"), false);
  assert.equal(app.agents.info(scope(fresh)).environment, null);
  for (const session of [a, b, legacy, fresh, empty]) {
    assert.equal(app.agents.info(scope(session)).memoryDirectory, memoryDirectory(app.store.root, session.id));
  }

  // A running older backend lacks the new projection field but supports memory.resolve.
  const originalInfo = app.agents.info.bind(app.agents);
  app.agents.info = (target) => {
    const info = originalInfo(target);
    if (target.sessionId === legacy.id) delete info.memoryDirectory;
    return info;
  };
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const errors: string[] = [], nativeDialogs: string[] = [], commands: Command[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", async (dialog) => { nativeDialogs.push(dialog.type()); await dialog.dismiss(); });
  page.on("websocket", (socket) => socket.on("framesent", ({ payload }) => {
    const message = JSON.parse(payload.toString()) as Command;
    if (message.op) commands.push(message);
  }));
  await page.addInitScript((view) => sessionStorage.setItem("view", JSON.stringify(view)), scope(a));
  await page.goto(app.origin);
  const panel = page.getByRole("region", { name: "会话初始化信息", exact: true });
  const details = panel.locator("details.session-environment");
  const prompt = panel.locator('pre[aria-label="系统提示词"]');
  const open = async () => {
    await panel.waitFor();
    if (!(await details.evaluate((el) => el.hasAttribute("open")))) await details.locator("summary").click();
    await panel.getByText("系统提示词", { exact: true }).waitFor();
    assert.equal(await panel.getByRole("button", { name: /授权/ }).count(), 0, "environment has no project authorization action");
    assert.equal(await panel.getByText("授权项目资源", { exact: true }).count(), 0);
  };
  const expectMemoryDirectory = async (session: Session) => {
    const directory = memoryDirectory(app.store.root, session.id);
    const row = panel.locator("p").filter({ hasText: "记忆目录：" });
    await page.waitForFunction((value) => [...document.querySelectorAll(".session-init-body p")]
      .some((el) => el.textContent?.includes(`记忆目录：${value}`)), directory);
    assert.equal(await row.locator(".local-path-text").textContent(), directory);
    assert.equal(await row.getByRole("button", { name: "复制路径", exact: true }).count(), 1);
    assert.equal(await row.getByRole("button", { name: "打开所在文件夹", exact: true }).count(), 1);
  };
  const select = async (session: Session) => {
    await page.locator(".history-row").filter({ has: page.getByRole("button", { name: `删除会话：${session.title}`, exact: true }) }).locator("button.history-item").click();
    await page.waitForFunction((title) => document.querySelector("#chat-title")?.textContent === title, session.title);
    await open();
    await expectMemoryDirectory(session);
  };
  const expectPrompt = async (expected: string) => {
    await page.waitForFunction((value) => document.querySelector('pre[aria-label="系统提示词"]')?.textContent === value, expected);
    assert.equal(await prompt.textContent(), expected, "system prompt is the complete persisted text");
    assert.equal(await prompt.locator("script, img, strong").count(), 0, "prompt is not interpreted as markup");
  };
  await open();
  await expectPrompt(promptA);
  await expectMemoryDirectory(a);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const memoryPath = panel.locator("p").filter({ hasText: "记忆目录：" }).locator(".local-path");
  await memoryPath.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await memoryPath.hover();
  await memoryPath.getByRole("button", { name: "复制路径", exact: true }).click();
  await page.waitForFunction(async (value) => await navigator.clipboard.readText() === value, memoryDirectory(app.store.root, a.id));
  assert.equal(await panel.locator("p").filter({ hasText: "工作目录：" }).locator(".local-path-text").textContent(), project);
  assert.match(await panel.innerText(), /工具：read、write、powershell/);
  assert.match(await panel.innerText(), /技能：fixture-skill/);
  assert.match(await panel.innerText(), /已加载扩展：2/);
  assert.match(await panel.innerText(), /测试环境警告/);
  for (const [width, height] of [[320, 800], [360, 800], [390, 480], [390, 844], [430, 900], [820, 1180], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    const box = await prompt.boundingBox();
    assert.ok(box && box.x >= -1 && box.x + box.width <= width + 1, `long prompt fits ${width}px viewport`);
    assert.equal(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true, "long prompt does not overflow environment panel");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, "no document horizontal overflow");
    await expectPrompt(promptA);
    if (process.env.AXIOM_ENVIRONMENT_ARTIFACTS && (width === 1440 || width === 390 && height === 844)) {
      mkdirSync(process.env.AXIOM_ENVIRONMENT_ARTIFACTS, { recursive: true });
      await page.screenshot({ path: join(process.env.AXIOM_ENVIRONMENT_ARTIFACTS, `environment-${width}.png`) });
    }
  }

  await select(b);
  await expectPrompt(promptB);
  assert.equal((await panel.textContent())?.includes("A-END"), false);
  // A background update must not replace B's visible environment or composer draft.
  await page.locator("#prompt").fill("B 的草稿保持不变");
  const updatedA = "A 的后台更新系统提示词\nA-UPDATED";
  save(a, environment(updatedA));
  app.agents.refresh(scope(a));
  await expectPrompt(promptB);
  assert.equal(await page.locator("#prompt").inputValue(), "B 的草稿保持不变");
  await select(a);
  await expectPrompt(updatedA);
  await select(b);
  await expectPrompt(promptB);
  assert.equal(await page.locator("#prompt").inputValue(), "B 的草稿保持不变");

  await select(legacy);
  await panel.getByText("此会话尚未记录系统提示词，下次执行时加载并展示。", { exact: true }).waitFor();
  assert.equal(await prompt.count(), 0, "legacy snapshot must not reuse another session's prompt");
  await select(fresh);
  await panel.getByText("尚未初始化，首次发送后展示实际生效的系统提示词。", { exact: true }).waitFor();
  assert.equal(await prompt.count(), 0);
  await select(empty);
  await expectPrompt("（空）");
  assert.equal(await panel.getByText(/尚未记录系统提示词|尚未初始化/).count(), 0, "empty prompt is distinct from an unavailable snapshot");
  assert.equal(commands.some((command) => command.op === "memory.resolve" && command.sessionId === legacy.id), true, "older backends resolve the real memory entry path");
  assert.equal(commands.some((command) => command.op === "agent.trust" || command.op === "prompt"), false, "viewing environments neither authorizes nor starts an execution");
  assert.deepEqual(errors, []);
  assert.deepEqual(nativeDialogs, []);
  console.log("PASS: real store environment snapshots, session memory directories and copy action, no authorization action, exact literal system prompt, legacy/uninitialized/empty states, responsive long text, session isolation and retained draft");
} finally {
  await browser.close();
  await app.close();
  rmSync(root, { recursive: true, force: true });
}
