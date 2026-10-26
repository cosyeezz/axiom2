import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { startServer } from "../src/server/index.js";
import { AppError, type Session, type Workspace } from "../src/shared/protocol.js";
const root = mkdtempSync(join(tmpdir(), "axiom-capability-ui-")), cwd = join(root, "project");
const artifacts = join(process.env.AXIOM_TEST_ARTIFACTS ?? "test-results", "capabilities");
mkdirSync(artifacts, { recursive: true });
writeFileSync(join(artifacts, "report.json"), JSON.stringify({ status: "running" }));
const previous = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
mkdirSync(process.env.AXIOM_PI_DIR, { recursive: true });
const description = (name: string) => `${name} 专门工作方法${name === "alpha-fixture" ? `。${"用于验证长简述在不同屏幕宽度下最多展示两行，超出后以省略号收起。".repeat(12)}` : ""}`;
for (const name of ["alpha-fixture", "beta-fixture"]) {
  mkdirSync(join(cwd, ".pi", "skills", name), { recursive: true });
  writeFileSync(join(cwd, ".pi", "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: ${description(name)}\n---\nACTUAL_SKILL_GUIDE`);
}
writeFileSync(join(root, "pi", "mcp.json"), JSON.stringify({ mcpServers: {
  "fixture-mcp": { command: "not-a-real-command", args: ["never-launch-for-ui"], env: { SECRET: "private-fixture-value" }, enabled: false },
} }));
const requests: any[] = [], opened: string[] = [];
const model = createServer(async (req, res) => {
  let raw = ""; for await (const chunk of req) raw += chunk; requests.push(JSON.parse(raw));
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const [delta, finish_reason] of [[{ role: "assistant", content: "技能已用于本次请求。" }, null], [{}, "stop"]])
    res.write(`data: ${JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  res.end("data: [DONE]\n\n");
});
await new Promise<void>(resolve => model.listen(0, "127.0.0.1", resolve));
writeFileSync(join(root, "pi", "models.json"), JSON.stringify({ providers: { fixture: { api: "openai-completions", baseUrl: `http://127.0.0.1:${(model.address() as any).port}/v1`, models: [{ id: "fixture" }] } } }));
writeFileSync(join(root, "pi", "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "fixture" } }));
writeFileSync(join(root, "pi", "settings.json"), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }));
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Browser | undefined;
try {
  app = await startServer({ root, port: 0, dev: true, openMemoryFile: async path => { opened.push(path); } });
  const w = app.store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: cwd, authorized: true } }) as Workspace;
  const s = app.store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: w.id }) as Session;
  const scope = { workspaceId: w.id, sessionId: s.id };
  await app.agents.command({ op: "agent.model", requestId: randomUUID(), ...scope, params: { selection: { provider: "fixture", id: "fixture", thinking: "off" } } });
  browser = await chromium.launch(process.env.AXIOM_TEST_BROWSER ? { executablePath: process.env.AXIOM_TEST_BROWSER } : { channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  await context.addInitScript(view => sessionStorage.setItem("view", JSON.stringify(view)), scope);
  const page = await context.newPage(), other = await context.newPage(), errors: string[] = [];
  for (const current of [page, other]) { current.setDefaultTimeout(15000); current.on("pageerror", error => errors.push(error.message)); await current.goto(app.accessUrl); }
  await page.locator("#prompt").fill("使用技能完成工作");
  // An unrelated failed subscription must never turn the capability panel offline.
  await page.evaluate(async () => { const transport = await import("/transport.ts" as string); (window as any).cleanupInvalidScope = transport.subscribeScope("invalid-fixture-scope", () => {}); });
  const trigger = page.getByRole("button", { name: "技能与 MCP", exact: true }), dialog = page.getByRole("dialog", { name: "技能与 MCP", exact: true });
  await trigger.click();
  assert.equal(await dialog.getByRole("button", { name: "当前会话", exact: true }).getAttribute("aria-pressed"), "true");
  assert.deepEqual(await dialog.getByRole("group", { name: "选择范围" }).getByRole("button").allTextContents(), ["当前会话", "全局默认"]);
  await dialog.getByRole("button", { name: "全局默认", exact: true }).click();
  await dialog.getByRole("searchbox").fill("alpha-fixture");
  const alpha = dialog.getByRole("checkbox", { name: "alpha-fixture", exact: true }); await alpha.waitFor();
  assert.equal(await alpha.isChecked(), true); assert.equal(await alpha.isEnabled(), true);
  const originalReload = app.agents.reloads.command.bind(app.agents.reloads);
  let reloadCalls = 0;
  app.agents.reloads.command = command => { reloadCalls++; return originalReload(command); };
  const apply = dialog.getByRole("button", { name: "应用并重新加载", exact: true });
  const openDefaults = async () => { await trigger.click(); await dialog.getByRole("button", { name: "全局默认", exact: true }).click(); await dialog.getByRole("searchbox").fill("alpha-fixture"); await alpha.waitFor(); };
  const applyAndRefresh = async () => { const loaded = page.waitForEvent("load"); await apply.click(); await loaded; };
  const beforeDraft = app.agents.capabilities.preferences();
  await alpha.click();
  await dialog.getByRole("searchbox").fill("beta-fixture");
  await dialog.getByRole("checkbox", { name: "beta-fixture", exact: true }).click();
  await dialog.getByRole("button", { name: /^MCP / }).click(); await dialog.getByRole("searchbox").fill("");
  const mcp = dialog.getByRole("checkbox", { name: "fixture-mcp", exact: true });
  await mcp.click(); await mcp.click();
  assert.equal(reloadCalls, 0, "several skill/MCP toggles cause no reload");
  assert.deepEqual(app.agents.capabilities.preferences(), beforeDraft, "checkboxes do not save immediately");
  await dialog.getByRole("button", { name: /^Skills / }).click(); await dialog.getByRole("searchbox").fill("alpha-fixture");
  assert.equal(await alpha.isChecked(), false);
  const originalPrepare = app.agents.capabilities.prepare.bind(app.agents.capabilities);
  app.agents.capabilities.prepare = async (...args) => { app!.agents.capabilities.prepare = originalPrepare; throw new AppError("REVISION_CONFLICT", "测试保存冲突，请重试。"); };
  await apply.click(); await dialog.getByRole("alert").filter({ hasText: "测试保存冲突" }).waitFor();
  assert.equal(await alpha.isChecked(), false, "failed application preserves the draft");
  assert.deepEqual(app.agents.capabilities.preferences(), beforeDraft);
  await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('.capability-apply-actions .btn-primary')?.disabled);
  await applyAndRefresh(); await openDefaults();
  assert.equal(reloadCalls, 2, "one attempt per application click");
  assert.equal(app.agents.capabilities.preferences().revision, beforeDraft.revision + 1, "multi-skill batch saves one revision");
  assert.equal(await alpha.isChecked(), false);
  const use = dialog.getByRole("button", { name: "使用技能：alpha-fixture", exact: true });
  assert.equal(await use.isEnabled(), true);
  assert.match(await use.getAttribute("data-tooltip") ?? "", /不受自动选用勾选影响/);
  await other.getByRole("button", { name: "技能与 MCP", exact: true }).click();
  const otherDialog = other.getByRole("dialog", { name: "技能与 MCP", exact: true });
  await otherDialog.getByRole("button", { name: "全局默认", exact: true }).click();
  await otherDialog.getByRole("searchbox").fill("alpha-fixture");
  const otherAlpha = otherDialog.getByRole("checkbox", { name: "alpha-fixture", exact: true }); await otherAlpha.waitFor(); assert.equal(await otherAlpha.isChecked(), false);
  await otherAlpha.click();
  assert.equal(await alpha.isChecked(), false, "another window's unsubmitted draft is local");
  await alpha.click();
  const otherLoaded = other.waitForEvent("load");
  await otherDialog.getByRole("button", { name: "应用并重新加载", exact: true }).click(); await otherLoaded;
  await dialog.getByRole("alert").filter({ hasText: "选择或资源目录已更新" }).waitFor();
  assert.equal(await alpha.isChecked(), true, "conflicting draft remains visible"); assert.equal(await apply.isDisabled(), true);
  await dialog.getByRole("button", { name: "重置选择", exact: true }).click();
  await alpha.click(); await applyAndRefresh(); await openDefaults();
  await other.getByRole("button", { name: "技能与 MCP", exact: true }).click();
  await otherDialog.getByRole("button", { name: "全局默认", exact: true }).click();
  await otherDialog.getByRole("searchbox").fill("alpha-fixture"); await otherAlpha.waitFor(); assert.equal(await otherAlpha.isChecked(), false);
  await use.click(); assert.equal(await use.isDisabled(), true);
  await dialog.getByRole("button", { name: "编辑技能文件：alpha-fixture", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "编辑文件内容", exact: true });
  await editor.waitFor();
  assert.equal(await dialog.count(), 0, "skill edit closes picker and opens shared preview");
  await editor.fill((await editor.inputValue()).replace("ACTUAL_SKILL_GUIDE", "ACTUAL_SKILL_GUIDE_UPDATED"));
  await page.getByRole("button", { name: "关闭文件预览", exact: true }).click();
  await page.getByRole("dialog", { name: "放弃未保存的文件编辑？", exact: true }).getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await editor.count(), 1, "declining discard preserves editing");
  const protectedReload = await page.evaluate(async scope => {
    try { await (await import("/session-page-reload.ts" as string)).reloadSessionAndPage(scope); return "unexpected refresh"; }
    catch (error) { return (error as Error).message; }
  }, scope);
  assert.match(protectedReload, /未保存编辑/);
  assert.match(await editor.inputValue(), /ACTUAL_SKILL_GUIDE_UPDATED/);
  assert.equal(requests.length, 0, "cold reload does not call model");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const editBox = (await editor.boundingBox())!, composerBox = (await page.locator(".composer-area").boundingBox())!;
    assert.ok(editBox.height >= 100 && editBox.x >= 0 && editBox.x + editBox.width <= width + 1);
    assert.ok(editBox.y + editBox.height <= composerBox.y + 1);
    await page.screenshot({ path: join(artifacts, `skill-editor-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  assert.match(readFileSync(join(cwd, ".pi/skills/alpha-fixture/SKILL.md"), "utf8"), /ACTUAL_SKILL_GUIDE_UPDATED/);
  assert.equal(opened.length, 0, "shared preview replaces native editor dispatch");
  await page.getByRole("button", { name: "关闭文件预览", exact: true }).click();
  assert.equal(await page.locator("#prompt").inputValue(), "使用技能完成工作");
  const draftCards = page.locator('.composer-area .skill-chip'); assert.equal(await draftCards.count(), 1);
  assert.equal(await page.locator('.composer-resources .capability-trigger').count(), 0);
  assert.equal(await page.locator('.usage .capability-trigger').count(), 1);
  assert.equal(await trigger.locator('use').getAttribute('href'), '#i-hand-click');
  await draftCards.getByRole("button", { name: "移除技能：alpha-fixture", exact: true }).click(); assert.equal(await draftCards.count(), 0);
  await trigger.click(); await dialog.getByRole("searchbox").fill("alpha-fixture"); await use.click();
  await dialog.getByRole("button", { name: "关闭技能与 MCP", exact: true }).click();
  await page.reload(); await draftCards.waitFor(); assert.equal(await draftCards.count(), 1);
  await page.evaluate(async scope => {
    const drafts = await import("/drafts.ts" as string);
    drafts.updateDraft(scope, { attachment: { name: "文档说明.md", text: "临时文档" }, images: [{ id: "img1", name: "截图.png", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=" }] });
  }, scope);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByRole("button", { name: "移除附件：文档说明.md", exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const chipBox = (await draftCards.boundingBox())!; assert.ok(chipBox.height <= 48);
    const inputBox = (await page.locator("#prompt").boundingBox())!, entryBox = (await trigger.boundingBox())!;
    assert.ok(entryBox.y >= inputBox.y + inputBox.height, "picker restored below input");
    assert.equal(entryBox.width, 44); assert.equal(entryBox.height, 44);
    await page.screenshot({ path: join(artifacts, `composer-mixed-${width}.png`) });
  }
  await page.getByRole("button", { name: "移除附件：文档说明.md", exact: true }).click();
  await page.getByRole("button", { name: "移除图片：截图.png", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator("#prompt").press("Enter");
  const historyCards = page.locator('.editable-user-message .skill-card'); await historyCards.waitFor();
  assert.equal(await historyCards.count(), 1); assert.equal(await draftCards.count(), 0);
  assert.match(JSON.stringify(requests[0].messages), /ACTUAL_SKILL_GUIDE/);
  assert.doesNotMatch(JSON.stringify(requests[0].messages.filter((m: any) => m.role === "system")), /alpha-fixture 专门工作方法/);
  assert.equal(await historyCards.locator('.skill-card-copy>strong').innerText(), "alpha-fixture");
  assert.equal(await historyCards.locator('.skill-card-copy>span').innerText(), description("alpha-fixture"));
  await trigger.click(); await dialog.getByRole("searchbox").fill("alpha-fixture");
  assert.equal(await dialog.getByRole("button", { name: "当前会话", exact: true }).getAttribute("aria-pressed"), "true");
  assert.equal(await alpha.isChecked(), false); assert.equal(await alpha.isEnabled(), true);
  await alpha.click();
  assert.equal(await alpha.isChecked(), true); assert.equal(await alpha.isEnabled(), true, "staging does not disable further choices");
  await dialog.getByRole("status").filter({ hasText: "有待应用选择" }).waitFor();
  assert.equal(await use.isEnabled(), true, "staged automatic choices do not affect manual use");
  const skillCopy = dialog.locator('.capability-choice > span');
  assert.equal(await skillCopy.innerText(), `alpha-fixture\n${description("alpha-fixture")}`, "skill rows contain only name and description, without extra path or pending-status lines");
  assert.match(await skillCopy.locator('strong').getAttribute('data-tooltip') ?? "", /alpha-fixture\/SKILL\.md/);
  assert.equal(await use.locator('use').getAttribute('href'), '#i-hand-click');
  for (const [width, height] of [[1440, 1000], [820, 1180], [390, 844], [360, 800], [390, 480]]) {
    await page.setViewportSize({ width, height });
    await page.waitForFunction(() => { const box = document.querySelector('.capability-settings')?.getBoundingClientRect(); return box && box.left >= 0 && box.right <= innerWidth + 1; });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.ok(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
    const summary = await dialog.locator('.capability-description').evaluate(node => {
      const style = getComputedStyle(node);
      return { height: node.getBoundingClientRect().height, lineHeight: parseFloat(style.lineHeight), clamp: style.webkitLineClamp, overflow: style.overflow, client: node.clientHeight, scroll: node.scrollHeight };
    });
    assert.equal(summary.clamp, "2"); assert.equal(summary.overflow, "hidden");
    assert.ok(summary.height <= summary.lineHeight * 2 + 1 && summary.scroll > summary.client, "long skill descriptions show at most two lines with native ellipsis");
    await use.scrollIntoViewIfNeeded();
    const box = await use.boundingBox(); assert.equal(box?.width, 44); assert.equal(box?.height, 44);
    const applyBox = (await apply.boundingBox())!;
    assert.ok(applyBox.height >= 44 && applyBox.x >= 0 && applyBox.x + applyBox.width <= width + 1 && applyBox.y + applyBox.height <= height, "batch apply remains accessible at all viewports");
    await page.screenshot({ path: join(artifacts, `skills-${width}-${height}.png`) });
  }
  // One session batch spans Skills and MCP, survives closing, then uses the full reload lifecycle.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await otherDialog.getByRole("button", { name: "当前会话", exact: true }).click();
  const defaultsBeforeSessionEdit = app.agents.capabilities.preferences(), requestsBeforeSessionEdit = requests.length;
  const beforeSessionEdit = app.agents.capabilities.state(scope), reloadsBeforeSessionEdit = reloadCalls;
  await dialog.getByRole("searchbox").fill("beta-fixture");
  await dialog.getByRole("checkbox", { name: "beta-fixture", exact: true }).click();
  await dialog.getByRole("button", { name: /^MCP / }).click(); await dialog.getByRole("searchbox").fill("");
  assert.equal(await mcp.isEnabled(), true); await mcp.click();
  await dialog.getByRole("button", { name: "关闭技能与 MCP", exact: true }).click();
  await trigger.click(); await dialog.getByRole("button", { name: /^MCP / }).click();
  assert.equal(await mcp.isChecked(), true, "draft survives closing and reopening");
  await dialog.getByRole("button", { name: "关闭技能与 MCP", exact: true }).click();
  const secondSession = await page.evaluate(async workspaceId => (await import("/transport.ts" as string)).command("session.create", {}, { workspaceId }), w.id) as Session;
  await page.locator(`.history-row[data-session-id="${secondSession.id}"] .history-item`).click();
  await page.waitForFunction(id => JSON.parse(sessionStorage.getItem("view") ?? "null")?.sessionId === id, secondSession.id);
  await page.locator(`.history-row[data-session-id="${s.id}"] .history-item`).click();
  await page.waitForFunction(id => JSON.parse(sessionStorage.getItem("view") ?? "null")?.sessionId === id, s.id);
  await page.reload();
  await trigger.click(); await dialog.getByRole("button", { name: /^MCP / }).click();
  assert.equal(await mcp.isChecked(), true, "draft survives session switches and page refresh");
  await dialog.getByRole("button", { name: /^Skills / }).click(); await dialog.getByRole("searchbox").fill("alpha-fixture");
  assert.equal(await alpha.isChecked(), true);
  await dialog.getByRole("button", { name: "全局默认", exact: true }).click();
  assert.equal(await alpha.isChecked(), false); await alpha.click();
  await dialog.getByRole("button", { name: "当前会话", exact: true }).click();
  assert.equal(reloadCalls, reloadsBeforeSessionEdit); assert.deepEqual(app.agents.capabilities.state(scope), beforeSessionEdit);
  const prepare = app.agents.capabilities.prepare.bind(app.agents.capabilities);
  let allowApply!: () => void;
  const applicationGate = new Promise<void>(resolve => { allowApply = resolve; });
  app.agents.capabilities.prepare = async (...args) => {
    if (args[3]) { app!.agents.capabilities.prepare = prepare; await applicationGate; }
    return prepare(...args);
  };
  const sessionLoaded = page.waitForEvent("load");
  try {
    await apply.click();
    await dialog.getByRole("status").filter({ hasText: "正在重新加载" }).waitFor();
    assert.equal(await alpha.isDisabled(), true); assert.equal(await alpha.isChecked(), true, "pending checkbox represents the labelled draft");
    assert.deepEqual(app.agents.capabilities.state(scope), beforeSessionEdit, "pending reload does not publish success");
    await other.waitForFunction(() => document.querySelector<HTMLInputElement>('.capability-item input[aria-label="alpha-fixture"]')?.disabled);
    await dialog.getByRole("button", { name: "关闭技能与 MCP", exact: true }).click();
    await trigger.click(); await dialog.getByRole("searchbox").fill("alpha-fixture");
    await dialog.getByRole("status").filter({ hasText: "正在重新加载" }).waitFor();
    assert.equal(await alpha.isChecked(), true); assert.equal(await alpha.isDisabled(), true);
  } finally { allowApply(); }
  await sessionLoaded;
  assert.equal(reloadCalls, reloadsBeforeSessionEdit + 1, "all Skills and MCP changes use one reload");
  await other.waitForFunction(() => { const input = document.querySelector<HTMLInputElement>('.capability-item input[aria-label="alpha-fixture"]'); return input?.checked && !input.disabled; });
  assert.deepEqual(app.agents.capabilities.preferences(), defaultsBeforeSessionEdit);
  assert.equal(requests.length, requestsBeforeSessionEdit, "idle reload does not call the model");
  assert.deepEqual(app.agents.capabilities.state(scope).selection?.mcp, ["fixture-mcp"]);
  const batchCatalog = await app.agents.capabilities.get(scope);
  const expectedSkills = new Set([...(beforeSessionEdit.selection?.skills ?? []), ...batchCatalog.skills.filter(item => ["alpha-fixture", "beta-fixture"].includes(item.name)).map(item => item.id)]);
  assert.deepEqual(new Set(app.agents.capabilities.state(scope).selection?.skills), expectedSkills, "batch adds both fixture skills and preserves other discovered selections");
  await trigger.click(); await dialog.getByRole("searchbox").fill("alpha-fixture");
  assert.equal(await apply.isDisabled(), true, "successful application clears the draft even after the dialog remounts");
  await dialog.getByRole("button", { name: "全局默认", exact: true }).click();
  assert.equal(await alpha.isChecked(), true, "the other target's pending draft survives the successful reload");
  await dialog.getByRole("button", { name: "重置选择", exact: true }).click();
  assert.equal(await alpha.isChecked(), false);
  await dialog.getByRole("button", { name: "关闭技能与 MCP", exact: true }).click();
  await page.getByRole("button", { name: "重新加载会话配置", exact: true }).click();
  const reloadDetails = page.getByRole("dialog", { name: "重新加载会话", exact: true });
  await reloadDetails.getByText("当前会话资源已重新加载。", { exact: true }).waitFor();
  assert.equal(await reloadDetails.getByText("当前会话的技能选择已更新，后续请求按此发现技能。", { exact: true }).count(), 0);
  await reloadDetails.getByRole("button", { name: "关闭重载详情", exact: true }).click();
  await page.screenshot({ path: join(artifacts, "skill-message-mobile.png") });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const reloadPage = page.waitForEvent("load");
  await page.evaluate(scope => { void import("/session-page-reload.ts" as string).then(module => module.reloadSessionAndPage(scope)); }, scope);
  await reloadPage;
  const applied = app.agents.capabilities.state(scope), catalogAfterReload = await app.agents.capabilities.get(scope);
  assert.ok(!applied.selection?.skills?.includes(catalogAfterReload.skills.find(item => item.name === "alpha-fixture")!.id));
  assert.deepEqual(applied.selection?.mcp, []);
  assert.ok(app.agents.info(scope).environment?.skills?.includes("alpha-fixture"));
  assert.doesNotMatch(app.agents.info(scope).environment?.systemPrompt ?? "", /alpha-fixture 专门工作方法/);
  await page.route("**/api/draft?**", async route => {
    if (route.request().method() === "POST") await route.fulfill({ status: 500, json: { code: "DRAFT_SAVE_FAILED", error: "测试草稿保存失败" } });
    else await route.continue();
  });
  const failedDraft = page.waitForResponse(response => response.url().includes("/api/draft?") && response.request().method() === "POST" && response.status() === 500);
  await page.locator("#prompt").fill("保存失败后保留输入");
  await failedDraft;
  assert.equal(await page.locator("#prompt").inputValue(), "保存失败后保留输入");
  const draftReloadFailure = await page.evaluate(async () => {
    try { await (await import("/draft-persistence.ts" as string)).flushDraftsForPageReload(); return "unexpected success"; }
    catch (error) { return (error as Error).message; }
  });
  assert.match(draftReloadFailure, /测试草稿保存失败/);
  await page.unroute("**/api/draft?**");
  await page.evaluate(async () => { await (await import("/draft-persistence.ts" as string)).flushDraftsForPageReload(); });
  assert.equal(await page.locator("#prompt").inputValue(), "保存失败后保留输入");
  await page.evaluate(async scope => {
    const drafts = await import("/drafts.ts" as string);
    drafts.updateDraft(scope, { skills: Array.from({ length: 33 }, (_, i) => ({ id: i.toString(16).padStart(64, "0"), name: `recalled-${i}`, description: "撤回恢复" })) });
  }, scope);
  await page.waitForFunction(async scope => {
    const saved = await fetch(`/api/draft?${new URLSearchParams(scope)}`).then(r => r.json());
    return saved.draft.skills?.length === 33 && saved.draft.text === "保存失败后保留输入";
  }, scope);
  const beforeLimit = requests.length;
  await page.locator("#prompt").press("Enter");
  await page.getByText("每条消息最多使用 32 个技能；请先移除多余引用", { exact: true }).waitFor();
  assert.equal(await draftCards.count(), 33); assert.equal(requests.length, beforeLimit);
  assert.deepEqual(errors, []);
  writeFileSync(join(artifacts, "report.json"), JSON.stringify({ status: "passed", checks: ["diagnostic text independent of connectivity", "batch defaults CAS and two windows", "staged Skills/MCP toggles cause no reload", "session batch preserves defaults and makes no idle inference", "one reload applies both Skills and MCP with page refresh", "draft survives close, failure and external conflict", "draft survives session switches and refresh", "application clears remounted draft and preserves other target", "S01 dedupe/removal", "shared skill edit and unsaved guard", "compact mixed attachments", "explicit reload applies choices", "persistent draft", "draft save failure preserves input and blocks reload until successful retry", "33 recovered references durable with send blocked", "real worker content and card", "five viewports and 44px targets", "long skill description two-line ellipsis at all five viewports"], errors }, null, 2));
  console.log(JSON.stringify({ status: "passed", artifacts }));
} catch (error) { writeFileSync(join(artifacts, "report.json"), JSON.stringify({ status: "failed", error: (error as Error).message }, null, 2)); await browser?.contexts()[0]?.pages()[0]?.screenshot({ path: join(artifacts, "failure.png") }).catch(() => {}); throw error; }
finally { await browser?.close(); await app?.close(); model.closeAllConnections(); await new Promise<void>(resolve => model.close(() => resolve())); if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous; rmSync(root, { recursive: true, force: true }); }
