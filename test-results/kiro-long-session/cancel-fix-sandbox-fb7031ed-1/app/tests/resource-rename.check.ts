import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "./temporary.js";
import { join, dirname } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
const root = mkdtempSync(join(tmpdir(), "axiom-rename-ui-")), pi = join(root, "shared");
const beforePi = process.env.PI_CODING_AGENT_DIR, beforeShared = process.env.AXIOM_PI_DIR;
process.env.PI_CODING_AGENT_DIR = pi; process.env.AXIOM_PI_DIR = pi;
function file(path: string, body: string) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body); }
const old = join(root, "pi/skills/old-skill");
file(join(old, "SKILL.md"), "---\nname: old-skill\ndescription: test skill\n---\n# Body\n");
file(join(old, "assets/data.txt"), "attached content");
file(join(pi, "mcp.json"), JSON.stringify({ mcpServers: { "old-mcp": { url: "https://fixture.invalid/mcp" } } }));
const app = await startServer({ root, port: 0, dev: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.AXIOM_TEST_BROWSER });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
const artifacts = process.env.AXIOM_RESOURCE_ARTIFACTS ?? "/tmp/axiom-resource-rename-ui"; mkdirSync(artifacts, { recursive: true });
try {
  await page.goto(app.origin + "/resources.html");
  await page.getByRole("button", { name: "重命名 old-skill", exact: true }).click();
  await page.getByLabel("新名称", { exact: true }).fill("new-skill");
  await page.getByRole("button", { name: "保存名称", exact: true }).click();
  await page.getByRole("button", { name: "重命名 new-skill", exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector<HTMLTextAreaElement>("#resource-content")?.value.includes("name: new-skill"));
  const next = join(dirname(old), "new-skill");
  assert.equal(existsSync(old), false); assert.equal(readFileSync(join(next, "assets/data.txt"), "utf8"), "attached content");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const rename = page.getByRole("button", { name: "重命名 new-skill", exact: true }), remove = page.getByRole("button", { name: "删除 new-skill", exact: true });
    assert.equal(await rename.innerText(), "重命名"); assert.equal(await remove.innerText(), "删除");
    for (const button of [rename, remove]) {
      const bounds = await button.boundingBox(); assert.ok(bounds && bounds.width >= 44 && bounds.height >= 44);
    }
    const renameBounds = (await rename.boundingBox())!, removeBounds = (await remove.boundingBox())!;
    assert.equal(renameBounds.y, removeBounds.y, "resource actions stay on one horizontal line");
    assert.ok(removeBounds.x >= renameBounds.x + renameBounds.width, "resource actions never overlap");
    const row = page.locator(".resource-list-row").filter({ has: rename });
    assert.ok(await row.evaluate(element => {
      const selection = element.querySelector<HTMLButtonElement>(".supplier-option")!, actions = element.querySelector<HTMLElement>(".resource-list-actions")!;
      const bounds = element.getBoundingClientRect(), actionBounds = actions.getBoundingClientRect();
      return getComputedStyle(element).borderTopStyle === "solid" && getComputedStyle(selection).borderTopWidth === "0px"
        && actionBounds.bottom <= bounds.bottom && actionBounds.top >= selection.getBoundingClientRect().bottom;
    }), "selection encloses the resource and its action row without an inner border");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await page.screenshot({ path: join(artifacts, `skill-actions-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const guide = page.locator("#resource-content"), content = await guide.inputValue();
  await guide.fill(content + "unsaved");
  await page.getByRole("button", { name: "删除 new-skill", exact: true }).click();
  await page.getByRole("button", { name: "继续编辑", exact: true }).click();
  assert.equal(await guide.inputValue(), content + "unsaved"); assert.ok(existsSync(next));
  await page.getByRole("button", { name: "删除 new-skill", exact: true }).click();
  await page.getByRole("button", { name: "放弃修改", exact: true }).click();
  await page.getByRole("dialog").getByText("永久删除技能文件及整个所属目录，包含脚本和附件，无法撤销。", { exact: true }).waitFor();
  await page.getByRole("button", { name: "取消", exact: true }).click(); assert.ok(existsSync(next));
  await page.getByRole("button", { name: "删除 new-skill", exact: true }).click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await page.getByRole("button", { name: "删除 new-skill", exact: true }).waitFor({ state: "hidden" }); assert.equal(existsSync(next), false);
  await page.getByRole("tab", { name: /^MCP/ }).click();
  await page.getByRole("button", { name: "重命名 old-mcp", exact: true }).click();
  await page.getByLabel("新名称", { exact: true }).fill("new-mcp");
  await page.getByRole("button", { name: "保存名称", exact: true }).click();
  await page.getByRole("button", { name: "删除 new-mcp", exact: true }).waitFor();
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(pi, "mcp.json"), "utf8")).mcpServers), ["new-mcp"]);
  await page.screenshot({ path: join(artifacts, "mcp-actions.png"), fullPage: true });
  await page.getByRole("button", { name: "删除 new-mcp", exact: true }).click();
  assert.equal(await page.getByRole("checkbox", { name: "同时清理此 MCP 的登录凭据" }).isChecked(), true);
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await page.getByRole("button", { name: "删除 new-mcp", exact: true }).waitFor({ state: "hidden" });
  assert.deepEqual(JSON.parse(readFileSync(join(pi, "mcp.json"), "utf8")).mcpServers, {});
  await page.reload(); await page.getByRole("button", { name: "刷新目录", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /重命名 (old-skill|new-skill|old-mcp|new-mcp)/ }).count(), 0);
  assert.deepEqual(errors, []); console.log(JSON.stringify({ passed: true, artifacts }));
} finally {
  await browser.close(); await app.close();
  if (beforePi === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = beforePi;
  if (beforeShared === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = beforeShared;
  rmSync(root, { recursive: true, force: true });
}
