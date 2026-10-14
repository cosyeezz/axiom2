// Isolated UI fixture: exercises real subscriptions and grouping, without calling a model.
// Run: npm exec tsx tests/tool-activity.check.ts
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Locator } from "playwright";
import { startServer } from "../src/server/index.js";
import type { AgentViews } from "../src/server/agents/views.js";
import { type ChatMessage } from "../src/shared/agent.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

async function toolColor(row: Locator, name: string) {
  assert.equal(await row.getAttribute("data-tool"), name);
  assert.equal(await row.locator(".tool-name").innerText(), name);
  const labelColor = await row.locator(".tool-name").evaluate((node) => getComputedStyle(node).color);
  const iconColor = await row.locator(".tool-icon").evaluate((node) => getComputedStyle(node).color);
  assert.equal(labelColor, iconColor, `${name}: label and icon share their computed color`);
  assert.equal(labelColor, await row.evaluate(node => getComputedStyle(node).color), `${name}: label and icon match the path/command foreground`);
  return labelColor;
}

const root = mkdtempSync(join(tmpdir(), "axiom-tool-activity-"));
const artifacts = resolve("test-results/tool-activity");
mkdirSync(artifacts, { recursive: true });
mkdirSync(join(root, "workspace"));
mkdirSync(join(root, "pi"));
const previousPi = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Browser | undefined;
try {
  app = await startServer({ root: join(root, "data"), port: 0, dev: true });
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: join(root, "workspace"), authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const views = (app.agents as unknown as { views: AgentViews }).views;
  const call = (id: string, name: string, input: unknown) => ({ id, name, input: JSON.stringify(input, null, 2) });
  const messages: ChatMessage[] = [
    { id: "user", role: "user", text: "检查工具调用展示" },
    { id: "a1", role: "assistant", text: "先检查文件。", calls: [call("read", "read", { path: "F:/项目/src/very-long-folder/".repeat(10) + "main.ts", offset: 12, limit: 40 })] },
    { id: "tool-read", role: "toolResult", toolCallId: "read", text: "export const ready = true;\n".repeat(1000) + "FULL_OUTPUT_END", status: "completed", durationMs: 123 },
    { id: "a2", role: "assistant", text: "", calls: [call("edit", "edit", { path: "src/main.ts", edits: [{ oldText: "false", newText: "true" }] }), call("stop", "bash", { command: "npm run check" })] },
    { id: "tool-edit", role: "toolResult", toolCallId: "edit", text: "starting\nError: target text not found", status: "failed", durationMs: 1500 },
    { id: "tool-stop", role: "toolResult", toolCallId: "stop", text: "", status: "cancelled" },
    { id: "a3", role: "assistant", text: "", calls: [call("shell", "powershell", { command: "npm test" }), call("unknown", "custom_tool", { query: "<img src=x onerror=alert(1)>" })] },
    { id: "tool-shell", role: "toolResult", toolCallId: "shell", text: "Running tests…", status: "running" },
    { id: "answer", role: "assistant", text: "## 检查结论\n\n需要核对修改目标。", status: "completed" },
  ];
  for (const message of messages) views.messageChanged(scope, message);
  views.flush(scope);
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((value) => sessionStorage.setItem("view", JSON.stringify(value)), scope);
  await page.goto(app.origin);
  const group = page.locator(".tool-activity");
  await page.waitForFunction(() => document.querySelector(".tool-activity > summary")?.textContent?.includes("5 项"));
  assert.equal(await group.count(), 1, "consecutive calls share one process block");
  assert.equal(await group.getAttribute("open"), null);
  const header = await group.locator(":scope > summary").innerText();
  for (const value of ["custom_tool", "<img src=x onerror=alert(1)>"]) assert.ok(header.includes(value), value);
  assert.equal(await group.locator(".activity-counts, .activity-hint").count(), 0);
  assert.equal(await group.getAttribute("data-status"), "running");
  assert.ok(!header.includes("target text not found"), "older failures do not replace the latest call");
  assert.equal(await group.locator(".activity-current:not(.activity-current-out) use").getAttribute("href"), "#i-tool-tool");
  const current = group.locator(".activity-current:not(.activity-current-out)");
  const unknownColor = await toolColor(current, "custom_tool");
  assert.equal(await group.locator(".execution-pulse").count(), 0, "tool rows only show duration, without a status indicator");
  assert.equal(await group.locator("pre").count(), 0, "closed tools do not mount heavy output");
  assert.equal(await page.locator(".message-actions").count(), 1, "copy chrome only belongs to the visible answer");
  assert.ok(await page.getByRole("heading", { name: "检查结论" }).isVisible());
  await group.locator(":scope > summary").focus();
  await page.keyboard.press("Enter");
  await page.locator(".tool-header").first().waitFor({ state: "visible" });
  assert.equal(await group.locator(".activity-ticker").count(), 0, "expanded group does not duplicate the latest summary");
  assert.equal(await group.locator(".tool-call > summary").count(), 5, "each tool has its own disclosure");
  assert.equal(await group.locator(".tool-detail").count(), 0, "opening the group only exposes the call list");
  const colors = new Map<string, string>();
  for (const name of ["read", "edit", "bash", "custom_tool"]) {
    colors.set(name, await toolColor(group.locator(`.tool-heading[data-tool="${name}"]`).first(), name));
  }
  const shellHeadings = group.locator('.tool-heading[data-tool="bash"]');
  assert.equal(await shellHeadings.count(), 2, "powershell is displayed as bash");
  assert.equal(await toolColor(shellHeadings.nth(1), "bash"), colors.get("bash"), "powershell display alias uses bash color");
  assert.equal(new Set(colors.values()).size, 1, "all tools share the same foreground");
  assert.equal(colors.get("custom_tool"), unknownColor, "collapsed and expanded unknown-tool colors match");
  assert.ok((await page.locator(".tool-call").first().innerText()).includes("L12–51"));
  assert.ok((await page.locator(".tool-call").first().innerText()).includes("0.1s"));
  assert.deepEqual(await group.locator(".tool-duration").allTextContents(), ["0.1s", "1.5s", "—", "—", "—"], "right side only shows recorded duration");
  assert.equal(await group.locator(".tool-header").first().evaluate(node => getComputedStyle(node, "::after").content), "none", "collapsed rows have no plus sign");
  await page.locator(".tool-call > summary").first().focus();
  await page.keyboard.press("Enter");
  assert.equal(await group.locator(".tool-detail").count(), 1, "only the selected call loads records");
  assert.equal(await group.locator(".tool-header").first().evaluate(node => getComputedStyle(node, "::after").content), "none", "expanded rows have no minus sign");
  await page.waitForFunction(() => document.querySelector(".tool-detail")?.textContent?.includes("FULL_OUTPUT_END"));
  assert.equal(await group.locator(".tool-truncated").count(), 0, "long output loads automatically");
  assert.ok((await group.locator('.tool-call[data-status="failed"]').innerText()).includes("target text not found"));
  await group.locator(":scope > summary").click();
  assert.equal(await group.locator("pre").count(), 0, "collapsing the process releases expanded detail DOM");
  await group.locator(":scope > summary").click();
  assert.equal(await group.locator(".tool-detail, .tool-call[open]").count(), 0, "reopening the group resets child disclosures");
  await page.locator(".tool-call > summary").first().click();
  await page.waitForFunction(() => document.querySelector(".tool-detail")?.textContent?.includes("FULL_OUTPUT_END"));
  assert.equal(await group.locator("img").count(), 0);
  await group.locator('.tool-call[data-status="running"] > summary').click();
  // Status-only updates retain open disclosures and refresh visible output.
  views.messageChanged(scope, { id: "tool-shell", role: "toolResult", text: "All tests passed", status: "completed" });
  views.flush(scope);
  await page.waitForFunction(() => document.querySelector('.tool-call[data-status="running"]') === null);
  assert.equal(await group.getAttribute("data-status"), "unknown", "missing tool results stay unknown, despite older failures");
  views.messageChanged(scope, { id: "tool-unknown", role: "toolResult", text: "Done", status: "completed" });
  views.flush(scope);
  await page.waitForFunction(() => document.querySelector('.tool-activity')?.getAttribute('data-status') === 'completed');
  assert.equal(await group.locator('.tool-call[data-status="failed"]').count(), 1, "local tool failure remains visible without failing the process");
  assert.equal(await group.locator('.tool-call[data-status="cancelled"]').count(), 1, "local tool cancellation does not stop the process");
  assert.equal(await group.locator('.activity-status').getAttribute('aria-label'), '已完成');
  assert.equal(await group.getAttribute("open"), "");
  assert.ok((await group.innerText()).includes("All tests passed"));
  for (const [width, height] of [[360, 800], [390, 844], [600, 960], [820, 1180], [1024, 768], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `page overflow ${width}`);
    assert.ok(await group.evaluate((node) => node.scrollWidth <= node.clientWidth + 1), `group overflow ${width}`);
    await group.screenshot({ path: join(artifacts, `expanded-${width}.png`) });
    await group.locator(":scope > summary").click();
    const geometry = await group.evaluate(node => {
      const title = node.querySelector(".activity-title")!.getBoundingClientRect();
      const ticker = node.querySelector(".activity-ticker")!.getBoundingClientRect();
      return { titleBottom: title.bottom, tickerTop: ticker.top, fits: node.scrollWidth <= node.clientWidth + 1 };
    });
    assert.ok(geometry.tickerTop >= geometry.titleBottom, `two-line collapsed summary ${width}`);
    assert.ok(geometry.fits, `collapsed overflow ${width}`);
    assert.ok((await current.innerText()).includes("custom_tool"), "late results do not rewind latest activity");
    await group.screenshot({ path: join(artifacts, `collapsed-${width}.png`) });
    await group.locator(":scope > summary").click();
  }
  await group.locator(":scope > summary").click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: join(artifacts, "collapsed-1440.png") });
  // A new call joins the existing first-ID group without reopening it.
  views.messageChanged(scope, { id: "answer", role: "assistant", text: "继续核查。", calls: [call("next", "read", { path: "README.md" })] });
  views.flush(scope);
  await page.waitForFunction(() => document.querySelector(".tool-activity > summary")?.textContent?.includes("6 项"));
  assert.equal(await group.count(), 1);
  assert.equal(await group.getAttribute("open"), null);
  await page.waitForFunction(() => document.querySelector(".activity-current:not(.activity-current-out)")?.textContent?.includes("README.md"));
  assert.equal(await toolColor(current, "read"), colors.get("read"), "collapsed read matches expanded read");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.waitForTimeout(350);
  views.messageChanged(scope, { id: "answer", role: "assistant", text: "继续核查。", calls: [call("next", "read", { path: "README.md" }), call("newest", "edit", { path: "latest.ts", edits: [] })] });
  views.flush(scope);
  await page.waitForFunction(() => document.querySelector(".activity-current-in")?.textContent?.includes("latest.ts"), null, { polling: "raf" });
  assert.equal(await group.locator(".activity-current-in").evaluate((node) => getComputedStyle(node).animationName), "activity-roll-in");
  assert.equal(await group.locator(".activity-current-out").getAttribute("aria-hidden"), "true");
  assert.equal(await group.locator(".activity-ticker").evaluate((node) => getComputedStyle(node).overflow), "hidden");
  await page.waitForTimeout(350);
  assert.equal(await group.locator(".activity-current").count(), 1);
  assert.equal(await toolColor(current, "edit"), colors.get("edit"), "collapsed edit matches expanded edit");
  await page.screenshot({ path: join(artifacts, "running-latest-1440.png") });
  await page.reload();
  await page.waitForFunction(() => document.querySelector(".tool-activity > summary")?.textContent?.includes("7 项"));
  assert.equal(await group.count(), 1);
  assert.ok((await group.locator(".activity-current:not(.activity-current-out)").innerText()).includes("latest.ts"));
  // Extend only after the original count/reload/responsive checks, preserving that fixture.
  // Shared icons and distinct names all use the same foreground.
  await page.emulateMedia({ reducedMotion: "reduce" });
  // Task tools have their own cards and are covered by delegation-order.check.ts.
  const additionalTools = ["write", "pwsh", "grep", "find", "ls", "web_search", "source_check", "fetch_content", "get_search_content"];
  views.messageChanged(scope, { id: "answer", role: "assistant", text: "继续核查。", calls: [
    call("next", "read", { path: "README.md" }), call("newest", "edit", { path: "latest.ts", edits: [] }),
    ...additionalTools.map((name) => call(`color-${name}`, `functions.${name}`, {})),
  ] });
  views.flush(scope);
  await current.locator('.tool-name').filter({ hasText: /^get_search_content$/ }).waitFor();
  const resultColor = await toolColor(current, "get_search_content");
  assert.equal(await group.getAttribute("open"), null);
  await group.locator(":scope > summary").click();
  for (const name of additionalTools) {
    colors.set(name, await toolColor(group.locator(`.tool-heading[data-tool="${name}"]`), name));
  }
  assert.equal(colors.get("get_search_content"), resultColor, "collapsed and expanded result colors match");
  const knownColors = [...colors].filter(([name]) => name !== "custom_tool").map(([, color]) => color);
  assert.equal(new Set(knownColors).size, 1, "all covered tools use the same foreground regardless of shared icons");
  // Long input/output is fetched only after opening the individual call.
  views.messageChanged(scope, { id: "long-input", role: "assistant", text: "", calls: [call("long-write", "write", { path: "large.txt", content: "x".repeat(17000) + "FULL_INPUT_END" })] });
  views.messageChanged(scope, { id: "tool-long-write", role: "toolResult", text: "first\n".repeat(4000), status: "running" });
  views.flush(scope);
  const longCall = group.locator('.tool-call[aria-label="write"]').last();
  await longCall.locator(":scope > summary").waitFor();
  assert.equal(await longCall.locator(".tool-detail").count(), 0, "new calls arrive collapsed in an open group");
  await longCall.locator(":scope > summary").click();
  await longCall.getByText(/FULL_INPUT_END/).waitFor();
  views.messageChanged(scope, { id: "tool-long-write", role: "toolResult", text: "first\n".repeat(4000) + "FINAL_OUTPUT_END", status: "completed" });
  views.flush(scope);
  await longCall.getByText(/FINAL_OUTPUT_END/).waitFor();
  assert.equal(await group.getAttribute("open"), "", "streaming completion keeps the group open");
  assert.equal(await longCall.locator(".tool-truncated").count(), 0);
  // A single-call example verifies the duplication shown in the reported screenshot.
  views.messageChanged(scope, { id: "single-boundary", role: "user", text: "查看单次工具调用" });
  views.messageChanged(scope, { id: "single", role: "assistant", text: "", calls: [call("single-shell", "powershell", { command: "rg -n tool app/src/client/chat" })] });
  views.messageChanged(scope, { id: "tool-single-shell", role: "toolResult", text: "app/src/client/chat/ToolActivity.tsx:44: tool-activity", status: "completed", durationMs: 800 });
  views.flush(scope);
  const single = page.locator(".tool-activity").last();
  await single.locator(".activity-current").waitFor();
  await single.screenshot({ path: join(artifacts, "single-collapsed.png") });
  await single.locator(":scope > summary").click();
  assert.equal(await single.locator(".tool-detail").count(), 0);
  await single.locator(".tool-call > summary").click();
  assert.equal((await single.innerText()).split("rg -n tool app/src/client/chat").length - 1, 1, "the command is shown exactly once");
  assert.equal(await single.locator(".tool-detail").count(), 1);
  await single.screenshot({ path: join(artifacts, "single-expanded.png") });
  assert.deepEqual(errors, []);
  console.log(`PASS: two-line collapse, layered tool disclosures, child reset on group reopen, automatic selected long input/output, streaming refresh, keyboard disclosure, colors, safe text, reload and 6 responsive widths. Screenshots: ${artifacts}`);
} finally {
  await browser?.close();
  await app?.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR;
  else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
