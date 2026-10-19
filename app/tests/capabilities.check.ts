import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { startServer } from "../src/server/index.js";
import { AppError, type Session, type Workspace } from "../src/shared/protocol.js";
const root = mkdtempSync(join(tmpdir(), "axiom-capability-ui-")), cwd = join(root, "project");
const artifacts = join(process.env.AXIOM_TEST_ARTIFACTS ?? "test-results", "capabilities");
mkdirSync(artifacts, { recursive: true });
const previous = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
mkdirSync(process.env.AXIOM_PI_DIR, { recursive: true });
for (const name of ["alpha-fixture", "beta-fixture"]) {
  mkdirSync(join(cwd, ".pi", "skills", name), { recursive: true });
  writeFileSync(join(cwd, ".pi", "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} 专门工作方法\n---\nInstructions`);
}
writeFileSync(join(root, "pi", "mcp.json"), JSON.stringify({ mcpServers: {
  "fixture-mcp": { command: "not-a-real-command", args: ["never-launch-for-ui"], env: { SECRET: "private-fixture-value" }, enabled: false },
} }));
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Browser | undefined;
try {
  app = await startServer({ root, port: 0, dev: true });
  const w = app.store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: cwd, authorized: true } }) as Workspace;
  const s = app.store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: w.id }) as Session;
  const scope = { workspaceId: w.id, sessionId: s.id };
  const catalog = await app.agents.capabilities.get(scope), alpha = catalog.skills.find(item => item.name === "alpha-fixture")!;
  await app.agents.capabilities.command({ op: "capabilities.save", requestId: randomUUID(), ...scope,
    params: { revision: 0, catalogRevision: catalog.revision, skills: [alpha.id], mcp: [] } });
  browser = await chromium.launch(process.env.AXIOM_TEST_BROWSER ? { executablePath: process.env.AXIOM_TEST_BROWSER } : { channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await context.addInitScript(view => sessionStorage.setItem("view", JSON.stringify(view)), scope);
  const page = await context.newPage(), other = await context.newPage(), errors: string[] = [];
  for (const current of [page, other]) {
    current.setDefaultTimeout(15000); current.on("pageerror", error => errors.push(error.message)); await current.goto(app.accessUrl);
  }
  const trigger = page.getByRole("button", { name: "技能与 MCP", exact: true });
  const dialog = page.getByRole("dialog", { name: "技能与 MCP", exact: true });
  await page.locator("#prompt").fill("能力设置期间保留草稿");
  await trigger.click(); await dialog.waitFor();
  await dialog.getByRole("searchbox", { name: "搜索能力" }).fill("alpha-fixture");
  const alphaCheckbox = dialog.getByRole("checkbox", { name: "alpha-fixture", exact: true });
  await alphaCheckbox.waitFor();
  assert.equal(await alphaCheckbox.isChecked(), true);
  const capabilityCommand = app.agents.capabilities.command.bind(app.agents.capabilities);
  app.agents.capabilities.command = async command => {
    if (command.op !== "capabilities.save") return capabilityCommand(command);
    app!.agents.capabilities.command = capabilityCommand;
    throw new AppError("REVISION_CONFLICT", "测试保存冲突，请重试。");
  };
  await alphaCheckbox.uncheck();
  await dialog.getByRole("alert").filter({ hasText: "测试保存冲突，请重试。" }).waitFor();
  await page.waitForFunction(() => {
    const checkbox = document.querySelector<HTMLInputElement>('.capability-item input[aria-label="alpha-fixture"]');
    return checkbox?.checked && !checkbox.disabled;
  });
  assert.deepEqual(app.agents.capabilities.state(scope).selection?.skills, [alpha.id]);
  await page.screenshot({ path: join(artifacts, "save-conflict.png") });
  await alphaCheckbox.uncheck(); await dialog.getByText("已保存到当前会话", { exact: true }).waitFor();
  assert.deepEqual(app.agents.capabilities.state(scope).selection?.skills, []);
  await other.getByRole("button", { name: "技能与 MCP", exact: true }).click();
  const otherDialog = other.getByRole("dialog", { name: "技能与 MCP", exact: true });
  await otherDialog.getByRole("searchbox").fill("alpha-fixture");
  await otherDialog.getByRole("checkbox", { name: "alpha-fixture", exact: true }).check();
  await page.waitForFunction(() => document.querySelector<HTMLInputElement>('.capability-item input[aria-label="alpha-fixture"]')?.checked);
  await dialog.getByRole("searchbox").fill("");
  await dialog.getByRole("button", { name: /^MCP/ }).click();
  await dialog.getByRole("checkbox", { name: "fixture-mcp", exact: true }).check();
  await dialog.getByText("已保存到当前会话", { exact: true }).waitFor();
  assert.deepEqual(app.agents.capabilities.state(scope).selection?.mcp, ["fixture-mcp"]);
  await page.waitForFunction(() => document.querySelector<HTMLInputElement>('.capability-item input[aria-label="fixture-mcp"]')?.checked);
  assert.ok(!await dialog.innerText().then(text => text.includes("private-fixture-value") || text.includes("never-launch-for-ui")));
  await dialog.getByRole("button", { name: "关闭技能与 MCP", exact: true }).click();
  assert.equal(await page.locator("#prompt").inputValue(), "能力设置期间保留草稿");
  assert.ok(await trigger.evaluate(node => document.activeElement === node));
  await page.reload(); await trigger.click(); await dialog.getByRole("button", { name: /^MCP/ }).click();
  await dialog.getByRole("checkbox", { name: "fixture-mcp", exact: true }).waitFor();
  assert.equal(await dialog.getByRole("checkbox", { name: "fixture-mcp", exact: true }).isChecked(), true);
  await dialog.getByRole("button", { name: /^Skills/ }).click();
  await dialog.getByRole("searchbox").fill("fixture");
  const plan = await app.agents.capabilities.prepare(scope);
  app.store.db.exec("BEGIN IMMEDIATE");
  app.agents.capabilities.lock(scope, plan);
  app.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt,endedAt) VALUES(?,?,'completed','{}',?,?)")
    .run(randomUUID(), scope.sessionId, Date.now(), Date.now());
  app.store.db.exec("COMMIT"); app.agents.capabilities.changed(scope);
  await dialog.getByText("当前会话 · 已锁定", { exact: true }).waitFor();
  assert.equal(await alphaCheckbox.isDisabled(), true);
  await otherDialog.getByText("当前会话 · 已锁定", { exact: true }).waitFor();
  assert.equal(await otherDialog.getByRole("checkbox", { name: "alpha-fixture", exact: true }).isDisabled(), true);
  for (const [width, height] of [[1440, 900], [390, 844], [390, 480]]) {
    await page.setViewportSize({ width, height });
    await trigger.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => {
      const box = document.querySelector('.capability-settings')?.getBoundingClientRect();
      return box && box.left >= 0 && box.right <= innerWidth + 1;
    });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.ok(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
    const metrics = await trigger.evaluate(node => { const box = node.getBoundingClientRect(), svg = node.querySelector("svg")!; return { width: box.width, height: box.height, icon: svg.getBoundingClientRect().width }; });
    assert.equal(metrics.width, 44); assert.equal(metrics.height, 44); assert.equal(metrics.icon, 16);
    await page.screenshot({ path: join(artifacts, `locked-${width}-${height}.png`) });
    if (height === 480) {
      const lastItem = dialog.getByRole("checkbox", { name: "beta-fixture", exact: true });
      await lastItem.scrollIntoViewIfNeeded();
      assert.ok(await lastItem.evaluate(node => {
        const item = node.getBoundingClientRect(), body = node.closest('.compression-body')!.getBoundingClientRect();
        return item.top >= body.top && item.bottom <= body.bottom;
      }), "short viewport can scroll to the last resource");
      await page.screenshot({ path: join(artifacts, "short-screen-scrolled.png") });
    }
  }
  await dialog.getByRole("button", { name: "关闭技能与 MCP", exact: true }).click();
  await trigger.click(); await dialog.getByText("当前会话 · 已锁定", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  // A focus tooltip may consume the first Escape before the native popover.
  if (await dialog.isVisible()) await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.ok(await trigger.evaluate(node => node === document.activeElement));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: "passed", artifacts, checks: "two windows, autosave, refresh, permanent lock, private metadata, draft/focus, 16px/44px, responsive" }));
} catch (error) {
  await browser?.contexts()[0]?.pages()[0]?.screenshot({ path: join(artifacts, "failure.png") }).catch(() => {});
  throw error;
} finally {
  await browser?.close(); await app?.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
