import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import { memoryDirectory } from "../src/server/memory-files.js";
import type { AgentInfo } from "../src/shared/agent.js";
import type { Command, Scope, Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-environment-"));
const previousPiDir = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "data", "pi");
const app = await startServer({ root: join(root, "data"), port: 0 });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const project = join(root, "project");
  mkdirSync(join(project, ".pi", "skills", "preview-skill"), { recursive: true });
  writeFileSync(join(project, ".pi", "skills", "preview-skill", "SKILL.md"), "---\nname: preview-skill\ndescription: Skill visible before sending\n---\nFixture");
  writeFileSync(join(project, ".pi", "APPEND_SYSTEM.md"), "PRELOADED_PROJECT_INSTRUCTION");
  writeFileSync(join(root, "data", "pi", "mcp.json"), JSON.stringify({ mcpServers: {
    fixture: { command: "never-start-this-server", description: "Preloaded MCP fixture", env: { TOKEN: "hidden-env-secret" } },
  } }));
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
    toolDefinitions: [{ name: "read", description: "Read fixture files", parameters: { type: "object", properties: { path: { type: "string", description: "完整参数说明".repeat(300) } }, required: ["path"] } }],
    skillDetails: [{ name: "fixture-skill", description: "Fixture skill description", path: join(project, "SKILL.md"), automatic: true }],
    mcp: [{ name: "fixture-mcp", description: "Fixture MCP description", source: join(project, ".pi", "mcp.json") }],
    memory: { topics: `<记忆Topic目录>fixture-memory\n${"记忆主题完整内容\n".repeat(100)}</记忆Topic目录>` },
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
  await page.addInitScript((view) => sessionStorage.setItem("view", JSON.stringify(view)), scope(fresh));
  await page.goto(app.origin);
  const panel = page.getByRole("region", { name: "会话初始化信息", exact: true });
  const tags = panel.getByRole("group", { name: "会话环境内容" });
  const tag = (title: string) => tags.getByRole("button", { name: title, exact: true });
  const section = (title: string) => panel.getByRole("region", { name: title, exact: true });
  const prompt = panel.locator('pre[aria-label="系统提示词"]');
  const openSection = async (title: string) => {
    if (await tag(title).getAttribute("aria-expanded") !== "true") await tag(title).click();
    await section(title).locator(":scope > .session-init-body").waitFor();
  };
  const open = async () => {
    await panel.waitFor();
    await openSection("系统提示词");
    assert.equal(await panel.getByRole("button", { name: /授权/ }).count(), 0, "environment has no project authorization action");
    assert.equal(await panel.getByText("授权项目资源", { exact: true }).count(), 0);
  };
  const expectMemoryDirectory = async (session: Session) => {
    await openSection("记忆内容");
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
  await panel.waitFor();
  await panel.getByText("已预加载 · 未启动 session", { exact: true }).waitFor();
  assert.deepEqual(await tags.locator("button").evaluateAll(elements => elements.map(el => el.getAttribute("aria-label"))), ["系统提示词", "工具列表", "记忆内容"]);
  assert.match(await tag("工具列表").innerText(), /\d+/);
  assert.equal(await tags.locator("svg").count(), 0, "compact tags have no disclosure icons");
  assert.equal(await tags.locator('[aria-expanded="true"]').count(), 0, "preloading does not expand panels");
  assert.equal(await panel.locator("pre").count(), 0, "collapsed bodies remain lazy");
  assert.equal(await panel.getByText(/Skill 列表|MCP 列表/).count(), 0, "skill and MCP lists are no longer displayed");
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const boxes = await tags.locator("button").evaluateAll(elements => elements.map(el => {
      const box = el.getBoundingClientRect(); return { y: box.y, height: box.height };
    }));
    assert.ok(boxes.every(box => box.y === boxes[0].y && box.height <= 44), `three compact tags stay on one row at ${width}px`);
    assert.ok((await panel.boundingBox())!.height < 100, "collapsed environment no longer consumes five full rows");
    if (process.env.AXIOM_ENVIRONMENT_ARTIFACTS && width !== 320) {
      mkdirSync(process.env.AXIOM_ENVIRONMENT_ARTIFACTS, { recursive: true });
      await page.screenshot({ path: join(process.env.AXIOM_ENVIRONMENT_ARTIFACTS, `environment-tags-${width}.png`) });
    }
  }
  await tag("记忆内容").focus();
  await page.keyboard.press("Enter");
  await section("记忆内容").waitFor();
  await page.keyboard.press("Space");
  await section("记忆内容").waitFor({ state: "hidden" });
  assert.ok(commands.some(command => command.op === "agent.environment" && command.sessionId === fresh.id), "preload starts before first click or send");
  assert.equal(app.agents.info(scope(fresh)).environment, null);
  assert.equal(app.store.db.prepare("SELECT COUNT(*) AS n FROM runs").get()?.n, 0);
  assert.equal(app.agents.pool.stats().created, 0);
  await openSection("工具列表");
  const readTool = section("工具列表").locator("details").filter({ has: page.getByText("read", { exact: true }) });
  assert.equal(await readTool.locator("pre").count(), 0);
  await readTool.locator("summary").click();
  await readTool.getByLabel("read schema", { exact: true }).waitFor();
  assert.match((await readTool.innerText()), /offset/);
  assert.equal(await tag("系统提示词").getAttribute("aria-expanded"), "false", "tool schema expansion does not open other sections");
  assert.equal((await panel.textContent())?.includes("hidden-env-secret"), false);
  await openSection("系统提示词");
  assert.ok((await prompt.textContent())?.includes("Skill visible before sending"), "hiding the skill list does not disable skill injection");
  const preloadsBeforeChange = commands.filter(command => command.op === "agent.environment").length;
  const catalog = await app.agents.capabilities.get(scope(fresh));
  await app.agents.capabilities.command({ requestId: crypto.randomUUID(), op: "capabilities.defaults.save", ...scope(fresh),
    params: { revision: catalog.preferencesRevision, catalogRevision: catalog.revision, kind: "skills", id: "preview-skill", checked: false } });
  await page.waitForFunction(() => {
    const text = document.querySelector('pre[aria-label="系统提示词"]')?.textContent;
    return text?.includes("PRELOADED_PROJECT_INSTRUCTION") && !text.includes("Skill visible before sending");
  });
  assert.ok(commands.filter(command => command.op === "agent.environment").length > preloadsBeforeChange, "preference revision refreshes an open preview");
  await select(a);
  await expectPrompt(promptA);
  await expectMemoryDirectory(a);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const memoryPath = panel.locator("p").filter({ hasText: "记忆目录：" }).locator(".local-path");
  await memoryPath.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await memoryPath.hover();
  await memoryPath.getByRole("button", { name: "复制路径", exact: true }).click();
  await page.waitForFunction(async (value) => await navigator.clipboard.readText() === value, memoryDirectory(app.store.root, a.id));
  assert.equal(await panel.locator("p").filter({ hasText: "工作目录：" }).locator(".local-path-text").textContent(), project);
  await openSection("工具列表");
  assert.equal(await panel.getByText("fixture-skill", { exact: true }).count(), 0);
  assert.equal(await panel.getByText("fixture-mcp", { exact: true }).count(), 0);
  assert.match(await panel.innerText(), /fixture-memory/);
  assert.match(await panel.innerText(), /已加载扩展：2/);
  assert.match(await panel.innerText(), /测试环境警告/);
  const runtimeReadTool = section("工具列表").locator("details").filter({ has: page.getByText("read", { exact: true }) });
  await runtimeReadTool.locator("summary").click();
  await runtimeReadTool.getByLabel("read schema", { exact: true }).waitFor();
  for (const [width, height] of [[320, 800], [360, 800], [390, 480], [390, 844], [430, 900], [820, 1180], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    const box = await prompt.boundingBox();
    assert.ok(box && box.x >= -1 && box.x + box.width <= width + 1, `long prompt fits ${width}px viewport`);
    assert.equal(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true, "long prompt does not overflow environment panel");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, "no document horizontal overflow");
    await expectPrompt(promptA);
    const expandedBlocks = await panel.locator("pre").evaluateAll(elements => elements.map(el => ({
      label: el.getAttribute("aria-label"),
      height: el.clientHeight,
      fullHeight: el.scrollHeight,
      maxHeight: getComputedStyle(el).maxHeight,
      overflowY: getComputedStyle(el).overflowY,
    })));
    assert.equal(expandedBlocks.length, 3, "prompt, schema and memory are all expanded");
    for (const block of expandedBlocks) {
      assert.equal(block.maxHeight, "none", `${block.label} has no height cap`);
      assert.equal(block.overflowY, "visible", `${block.label} does not create an inner scroller`);
      assert.ok(block.height > 360 && block.fullHeight <= block.height + 1, `${block.label} displays its full long content at ${width}px`);
    }
    assert.deepEqual(await panel.locator("*").evaluateAll(elements => elements.filter(el => {
      const style = getComputedStyle(el);
      return /auto|scroll/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1;
    }).map(el => el.className)), [], "expanded environment has no nested vertical scrollers");
    if (process.env.AXIOM_ENVIRONMENT_ARTIFACTS && (width === 1440 || width === 390 && height === 844)) {
      mkdirSync(process.env.AXIOM_ENVIRONMENT_ARTIFACTS, { recursive: true });
      await page.screenshot({ path: join(process.env.AXIOM_ENVIRONMENT_ARTIFACTS, `environment-${width}.png`) });
    }
  }

  // Give the environment a following sibling to verify sticky containment at its end.
  await panel.evaluate(node => {
    const tail = document.createElement("div");
    tail.id = "environment-sticky-tail";
    tail.style.height = "1800px";
    node.after(tail);
  });
  const settleSticky = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await panel.evaluate(node => {
      const thread = node.closest<HTMLElement>(".thread")!;
      thread.scrollTop += node.getBoundingClientRect().top - thread.getBoundingClientRect().top + 250;
    });
    await settleSticky();
    const pinned = await tags.evaluate(node => {
      const rect = node.getBoundingClientRect(), thread = node.closest(".thread")!.getBoundingClientRect();
      return { top: rect.top - thread.top, position: getComputedStyle(node).position,
        background: getComputedStyle(node).backgroundColor,
        clickable: [...node.querySelectorAll("button")].every(button => {
          const box = button.getBoundingClientRect();
          return button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
        }) };
    });
    assert.equal(pinned.position, "sticky");
    assert.ok(Math.abs(pinned.top - 8) < 2, `environment tags pin with top clearance at ${width}px`);
    assert.notEqual(pinned.background, "rgba(0, 0, 0, 0)");
    assert.equal(pinned.clickable, true, "all pinned tags remain reachable");
    await runtimeReadTool.evaluate(node => {
      const thread = node.closest<HTMLElement>(".thread")!;
      thread.scrollTop += node.getBoundingClientRect().top - thread.getBoundingClientRect().top + 100;
    });
    await settleSticky();
    const tagBottom = (await tags.boundingBox())!;
    const toolTop = (await runtimeReadTool.locator("summary").boundingBox())!.y;
    assert.ok(Math.abs(toolTop - tagBottom.y - tagBottom.height) < 2, "nested schema heading pins below tags without overlap");
    if (process.env.AXIOM_ENVIRONMENT_ARTIFACTS) {
      await page.screenshot({ path: join(process.env.AXIOM_ENVIRONMENT_ARTIFACTS, `environment-sticky-${width}.png`) });
    }
    await panel.evaluate(node => {
      const thread = node.closest<HTMLElement>(".thread")!;
      thread.scrollTop += node.getBoundingClientRect().bottom - thread.getBoundingClientRect().top + 30;
    });
    await settleSticky();
    assert.ok(await tags.evaluate(node => node.getBoundingClientRect().bottom <= node.closest(".thread")!.getBoundingClientRect().top + 1), "tags leave the viewport after the environment ends");
  }
  await panel.evaluate(node => {
    const thread = node.closest<HTMLElement>(".thread")!;
    thread.scrollTop += node.getBoundingClientRect().top - thread.getBoundingClientRect().top + 250;
  });
  await settleSticky();
  await tag("系统提示词").click();
  assert.equal(await tag("系统提示词").getAttribute("aria-expanded"), "false", "pinned tag collapses its panel");
  await tag("工具列表").click();
  await tag("记忆内容").click();
  await page.waitForFunction(() => !document.querySelector(".environment-tags")?.hasAttribute("data-sticky-disclosure"));
  await page.locator("#environment-sticky-tail").evaluate(node => node.remove());
  // Session selection below uses the desktop history sidebar, hidden on narrow screens.
  await page.setViewportSize({ width: 1440, height: 900 });

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
  await panel.getByText("已预加载 · 未启动 session", { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('pre[aria-label="系统提示词"]')?.textContent?.includes("PRELOADED_PROJECT_INSTRUCTION"));
  assert.equal(app.agents.info(scope(fresh)).environment, null, "preview stays separate from runtime snapshots");
  await select(empty);
  await expectPrompt("（空）");
  assert.equal(await panel.getByText(/尚未记录系统提示词|尚未初始化/).count(), 0, "empty prompt is distinct from an unavailable snapshot");
  assert.equal(commands.some((command) => command.op === "memory.resolve" && command.sessionId === legacy.id), true, "older backends resolve the real memory entry path");
  assert.equal(commands.some((command) => command.op === "agent.trust" || command.op === "prompt"), false, "viewing environments neither authorizes nor starts an execution");
  assert.deepEqual(errors, []);
  assert.deepEqual(nativeDialogs, []);
  console.log("PASS: three compact icon-free tags, keyboard toggling, no skill/MCP lists, eager no-session preview, tool schema, memory, no credentials, preference refresh, real runtime snapshots, literal prompt, legacy/empty states, responsive long text, session isolation and retained draft");
} finally {
  await browser.close();
  await app.close();
  if (previousPiDir === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPiDir;
  rmSync(root, { recursive: true, force: true });
}
