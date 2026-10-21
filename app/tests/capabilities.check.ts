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
for (const name of ["alpha-fixture", "beta-fixture"]) {
  mkdirSync(join(cwd, ".pi", "skills", name), { recursive: true });
  writeFileSync(join(cwd, ".pi", "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} 专门工作方法\n---\nACTUAL_SKILL_GUIDE`);
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
  await trigger.click(); await dialog.getByRole("searchbox").fill("alpha-fixture");
  const alpha = dialog.getByRole("checkbox", { name: "alpha-fixture", exact: true }); await alpha.waitFor();
  assert.equal(await alpha.isChecked(), true); assert.equal(await alpha.isEnabled(), true);
  const original = app.agents.capabilities.command.bind(app.agents.capabilities);
  app.agents.capabilities.command = async command => { if (command.op !== "capabilities.defaults.save") return original(command); app!.agents.capabilities.command = original; throw new AppError("REVISION_CONFLICT", "测试保存冲突，请重试。"); };
  await alpha.click(); await dialog.getByRole("alert").filter({ hasText: "测试保存冲突" }).waitFor();
  await page.waitForFunction(() => { const input = document.querySelector<HTMLInputElement>('.capability-item input[aria-label="alpha-fixture"]'); return input?.checked && !input.disabled; });
  await alpha.click(); await dialog.getByText("已保存选择；重新加载后应用到当前会话", { exact: true }).waitFor();
  const use = dialog.getByRole("button", { name: "使用技能：alpha-fixture", exact: true });
  assert.equal(await use.isDisabled(), true);
  assert.match(await use.getAttribute("data-tooltip") ?? "", /请先勾选技能/);
  await other.getByRole("button", { name: "技能与 MCP", exact: true }).click();
  const otherDialog = other.getByRole("dialog", { name: "技能与 MCP", exact: true }); await otherDialog.getByRole("searchbox").fill("alpha-fixture");
  const otherAlpha = otherDialog.getByRole("checkbox", { name: "alpha-fixture", exact: true }); await otherAlpha.waitFor(); assert.equal(await otherAlpha.isChecked(), false);
  await otherAlpha.click(); await page.waitForFunction(() => document.querySelector<HTMLInputElement>('.capability-item input[aria-label="alpha-fixture"]')?.checked);
  await use.click(); assert.equal(await use.isDisabled(), true);
  await dialog.getByRole("button", { name: "编辑技能文件：alpha-fixture", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "编辑文件内容", exact: true });
  await editor.waitFor();
  assert.equal(await dialog.count(), 0, "skill edit closes picker and opens shared preview");
  await editor.fill((await editor.inputValue()).replace("ACTUAL_SKILL_GUIDE", "ACTUAL_SKILL_GUIDE_UPDATED"));
  page.once("dialog", prompt => prompt.dismiss());
  await page.getByRole("button", { name: "关闭文件预览", exact: true }).click();
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
  assert.equal(await historyCards.locator('.skill-card-copy>strong').innerText(), "alpha-fixture");
  assert.equal(await historyCards.locator('.skill-card-copy>span').innerText(), "alpha-fixture 专门工作方法");
  await trigger.click(); await dialog.getByRole("searchbox").fill("alpha-fixture");
  assert.equal(await alpha.isEnabled(), true, "global defaults remain editable in locked sessions"); await alpha.click();
  await dialog.getByText("已保存选择；重新加载后应用到当前会话", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "当前会话", exact: true }).click();
  assert.equal(await alpha.isChecked(), true); assert.equal(await alpha.isDisabled(), true);
  assert.equal(await use.isEnabled(), true, "global changes do not change the running snapshot");
  assert.match(await use.getAttribute("data-tooltip") ?? "", /当前会话仍已加载/);
  assert.equal(await use.locator('use').getAttribute('href'), '#i-hand-click');
  for (const [width, height] of [[1440, 1000], [820, 1180], [390, 844], [360, 800], [390, 480]]) {
    await page.setViewportSize({ width, height });
    await page.waitForFunction(() => { const box = document.querySelector('.capability-settings')?.getBoundingClientRect(); return box && box.left >= 0 && box.right <= innerWidth + 1; });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.ok(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
    await use.scrollIntoViewIfNeeded();
    const box = await use.boundingBox(); assert.equal(box?.width, 44); assert.equal(box?.height, 44);
    await page.screenshot({ path: join(artifacts, `skills-${width}-${height}.png`) });
  }
  await dialog.getByRole("button", { name: "关闭技能与 MCP", exact: true }).click();
  await page.screenshot({ path: join(artifacts, "skill-message-mobile.png") });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const reloadPage = page.waitForEvent("load");
  await page.evaluate(scope => { void import("/session-page-reload.ts" as string).then(module => module.reloadSessionAndPage(scope)); }, scope);
  await reloadPage;
  const applied = app.agents.capabilities.state(scope), catalogAfterReload = await app.agents.capabilities.get(scope);
  assert.ok(!applied.selection?.skills?.includes(catalogAfterReload.skills.find(item => item.name === "alpha-fixture")!.id));
  assert.ok(!app.agents.info(scope).environment?.skills?.includes("alpha-fixture"));
  await page.route("**/api/draft?**", async route => {
    if (route.request().method() === "POST") await route.fulfill({ status: 500, json: { code: "DRAFT_SAVE_FAILED", error: "测试草稿保存失败" } });
    else await route.continue();
  });
  await page.locator("#prompt").fill("保存失败后保留输入");
  await page.getByRole("alert").filter({ hasText: "测试草稿保存失败" }).waitFor();
  assert.equal(await page.locator("#prompt").inputValue(), "保存失败后保留输入");
  await page.unroute("**/api/draft?**");
  await page.getByRole("button", { name: "重试草稿保存", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "测试草稿保存失败" }).waitFor({ state: "hidden" });
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
  writeFileSync(join(artifacts, "report.json"), JSON.stringify({ status: "passed", checks: ["diagnostic text independent of connectivity", "global CAS and two windows", "locked snapshot", "S01 dedupe/removal", "shared skill edit and unsaved guard", "compact mixed attachments", "explicit reload applies choices", "persistent draft", "draft save failure and retry", "33 recovered references durable with send blocked", "real worker content and card", "five viewports and 44px targets"], errors }, null, 2));
  console.log(JSON.stringify({ status: "passed", artifacts }));
} catch (error) { writeFileSync(join(artifacts, "report.json"), JSON.stringify({ status: "failed", error: (error as Error).message }, null, 2)); await browser?.contexts()[0]?.pages()[0]?.screenshot({ path: join(artifacts, "failure.png") }).catch(() => {}); throw error; }
finally { await browser?.close(); await app?.close(); model.closeAllConnections(); await new Promise<void>(resolve => model.close(() => resolve())); if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous; rmSync(root, { recursive: true, force: true }); }
