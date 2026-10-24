import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import { memoryDirectory } from "../src/server/memory-files.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const root = realpathSync(mkdtempSync(join(tmpdir(), "axiom-memory-english-")));
const project = join(root, "project"); mkdirSync(project);
const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi");
const app = await startServer({ root, port: 0, dev: true });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const workspace = app.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const states = [
    ["Not started", "未开始"], ["In progress", "进行中"], ["Completed", "已完成"],
    ["Waiting", "等待"], ["Failed", "失败"], ["Abandoned", "已放弃"],
  ] as const;
  const source = states.map(([state], index) => `# [${state}] English goal ${index + 1}`).join("\n");
  const entry = join(memoryDirectory(root, session.id), "MEMORY.md");
  mkdirSync(memoryDirectory(root, session.id), { recursive: true });
  writeFileSync(entry, source); app.agents.memories.scan();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => sessionStorage.setItem("view", JSON.stringify(value)), scope);
  await page.goto(app.origin);
  const toggle = page.getByRole("button", { name: "上下文与会话记忆", exact: true });
  await toggle.click();
  const card = page.getByRole("dialog", { name: "上下文与会话记忆", exact: true });
  await card.getByText("English goal 1", { exact: true }).waitFor();
  assert.equal(await card.locator(".memory-goals > li").count(), states.length);
  assert.equal(await card.locator(".memory-document-title").count(), 0);
  for (const [english, normalized] of states) {
    const icon = card.locator(`.memory-task-marker > svg.memory-state-icon[data-state="${normalized}"]`);
    assert.equal(await icon.count(), 1, english);
    assert.ok(await icon.locator("path, circle").count(), `${english}: real SVG geometry`);
    assert.ok(await icon.isVisible(), `${english}: visible icon`);
  }
  const completed = card.locator('svg.memory-state-icon[data-state="已完成"]');
  assert.equal(await completed.locator("path").count(), 2);
  assert.equal(await completed.locator('path > animate[attributeName="stroke-dashoffset"]').count(), 2);
  for (const theme of ["dark", "light"]) {
    await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
    const colors = await completed.evaluate(icon => {
      const paths = icon.querySelectorAll("path");
      const probe = document.createElement("span");
      probe.style.color = "var(--success)"; icon.parentElement!.append(probe);
      const success = getComputedStyle(probe).color; probe.remove();
      return { first: getComputedStyle(paths[0]).stroke, second: getComputedStyle(paths[1]).stroke, inherited: getComputedStyle(icon).color, success };
    });
    assert.equal(colors.first, colors.inherited, `${theme}: first check keeps its inherited color`);
    assert.equal(colors.second, colors.success, `${theme}: smaller second check is success green`);
    assert.notEqual(colors.first, colors.second, `${theme}: only the smaller check turns green`);
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert.doesNotMatch(await card.innerText(), /\[(?:Not started|In progress|Completed|Waiting|Failed|Abandoned)\]/i);
    assert.equal(await card.locator(".memory-state-icon").count(), states.length);
    assert.equal(await card.evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
  }
  // A mixed-language live edit must update the glyph without rewriting the English source.
  const updated = source.replace("[Not started]", "[已完成]").replace("[In progress]", "[in progress]");
  writeFileSync(entry, updated); app.agents.memories.scan();
  await card.locator('.memory-goals > li[data-state="已完成"]').filter({ hasText: "English goal 1" }).waitFor();
  assert.equal(await card.locator('svg.memory-state-icon[data-state="已完成"]').count(), 2);
  assert.equal(await card.locator('svg.memory-state-icon[data-state="进行中"]').count(), 1);
  assert.equal(readFileSync(entry, "utf8"), updated);
  assert.deepEqual(errors, []);
  console.log("English memory states UI passed: six SVG states, green smaller completion check in dark/light themes, stroke animations, clean goal titles, desktop/mobile, mixed-language live updates, unchanged source.");
} finally {
  await browser?.close(); await app.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
