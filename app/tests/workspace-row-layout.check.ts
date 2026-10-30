import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import type { Workspace } from "../src/shared/protocol.js";
import { tmpdir } from "./temporary.js";

const root = mkdtempSync(join(tmpdir(), "axiom-workspace-row-"));
const output = resolve(process.env.AXIOM_TEST_ARTIFACTS || "../test-results/workspace-row-layout");
mkdirSync(output, { recursive: true });
const app = await startServer({ root: join(root, "data"), port: 0, dev: true });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const evidence: unknown[] = [];
try {
  const projects = ["KF", "工作空间名称很长也不能把操作图标挤到下一行", "a-long-English-workspace-name"];
  const workspaces = projects.map(name => {
    const path = join(root, name); mkdirSync(path);
    return app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path, authorized: true } }) as Workspace;
  });
  for (const touch of [true, false]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: touch, isMobile: touch, permissions: ["clipboard-read", "clipboard-write"], reducedMotion: "reduce" });
    await context.addInitScript("window.__name = value => value");
    let revealed = "";
    await context.routeWebSocket("**/ws", socket => {
      const server = socket.connectToServer();
      socket.onMessage(raw => {
        const command = JSON.parse(String(raw));
        if (command.op === "paths.reveal") {
          revealed = command.params.path;
          socket.send(JSON.stringify({ type: "receipt", requestId: command.requestId, ok: true, data: null }));
        } else server.send(raw);
      });
      server.onMessage(raw => socket.send(raw));
    });
    const page = await context.newPage();
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(app.origin);
    await page.locator("#toggle-history").click();
    await page.locator("#workspace-picker > summary").click();
    for (const width of touch ? [320, 390, 430, 1024] : [390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      for (const scale of [1, 1.5]) {
        await page.evaluate(scale => document.documentElement.style.setProperty("--display-font-scale", String(scale)), scale);
        const geometry = await page.locator(".workspace-row").evaluateAll(rows => rows.map(row => {
          const rect = (node: Element) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
          const option = row.querySelector(".workspace-option")!, name = row.querySelector("strong")!, actions = row.querySelector(".workspace-actions")!;
          return { row: rect(row), option: rect(option), name: rect(name), actions: rect(actions), buttons: [...actions.querySelectorAll("button")].map(rect), noOverflow: row.scrollWidth <= row.clientWidth + 1 };
        }));
        assert.equal(geometry.length, 3);
        for (const g of geometry) {
          assert.ok(g.noOverflow, `row does not overflow at ${width}/${touch}/${scale}: ${JSON.stringify(g)}`);
          assert.ok(g.name.width > 0, `name retains visible space at ${width}/${touch}/${scale}: ${JSON.stringify(g)}`);
          assert.ok(Math.abs(g.option.y + g.option.height / 2 - g.actions.y - g.actions.height / 2) <= 1, "name and right-hand actions share a single centered row");
          if (touch) {
            assert.ok(g.name.right <= g.actions.x + 1, "name does not overlap touch actions");
            assert.ok(g.row.height <= 44 * scale + 1, "no second operation row");
            assert.equal(g.buttons.length, 4, "all four actions remain directly visible; no More menu");
            assert.ok(g.buttons.every(b => b.width >= 44 && b.height >= 44), "touch targets stay at least 44px");
          }
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        evidence.push({ touch, width, scale, geometry });
        await page.screenshot({ path: join(output, `${touch ? "touch" : "mouse"}-${width}-${scale}.png`) });
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => document.documentElement.style.setProperty("--display-font-scale", "1"));
    if (!await page.locator("#history-sidebar").isVisible()) await page.locator("#toggle-history").click();
    if (!await page.locator("#workspace-picker").evaluate(node => (node as HTMLDetailsElement).open)) await page.locator("#workspace-picker > summary").click();
    const row = page.locator(".workspace-row").filter({ has: page.getByRole("button", { name: "KF", exact: true }) });
    await row.hover();
    await row.getByRole("button", { name: "复制工作空间路径", exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), workspaces[0].path);
    await row.getByRole("button", { name: "打开工作空间文件夹", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.workspace-row .path-actions button[aria-busy="true"]'));
    assert.equal(revealed, workspaces[0].path, "folder open preserves its original target");
    const before = await page.locator("#workspace-picker summary strong").textContent();
    await row.getByRole("button", { name: "置顶工作空间：KF", exact: true }).click();
    await row.getByRole("button", { name: "取消置顶工作空间：KF", exact: true }).waitFor();
    assert.equal(await page.locator("#workspace-picker summary strong").textContent(), before, "actions do not navigate");
    await row.getByRole("button", { name: "取消置顶工作空间：KF", exact: true }).click();
    await row.getByRole("button", { name: "置顶工作空间：KF", exact: true }).waitFor();
    const remove = row.getByRole("button", { name: "删除工作空间：KF", exact: true });
    await remove.click();
    const confirmation = page.getByRole("dialog", { name: "删除工作空间", exact: true });
    await confirmation.waitFor();
    await confirmation.getByRole("button", { name: "取消", exact: true }).click();
    await confirmation.waitFor({ state: "hidden" });
    assert.equal(await remove.evaluate(node => node === document.activeElement), true);
    assert.equal(app.store.workspaces().length, 3, "cancel preserves workspaces");
    await row.getByRole("button", { name: "KF", exact: true }).press("F2");
    const input = page.getByRole("textbox", { name: "工作空间名称", exact: true });
    await input.waitFor();
    assert.equal(await row.locator(".workspace-actions").isVisible(), false, "editing retains the full row");
    await input.press("Escape");
    assert.deepEqual(errors, []);
    await context.close();
  }
  writeFileSync(join(output, "result.json"), JSON.stringify({ success: true, evidence, scope: "real isolated server and UI; only OS folder reveal is stubbed" }, null, 2));
  console.log(`PASS workspace rows: single row, four direct actions, long names, touch 320/390/430/1024, mouse 390/1440, 100/150% scale, clipboard/open/pin/delete-cancel/rename. ${output}`);
} finally { await browser.close(); await app.close(); rmSync(root, { recursive: true, force: true }); }
