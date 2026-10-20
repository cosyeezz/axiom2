// Render the real report component in Chromium; transport is stubbed at its boundary.
// Run: node --import tsx tests/task-report.check.ts
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const bundle = await build({
  stdin: { resolveDir: resolve("."), loader: "tsx", contents: `
    import { createElement as h } from 'react';
    import { createRoot } from 'react-dom/client';
    import { TaskReportBody } from './src/client/tasks/TaskReportBody.tsx';
    const text = '完整证据。'.repeat(4000) + '报告最后一行';
    const scope = { workspaceId: 'workspace', sessionId: 'parent' };
    // The model's read_result page is bounded; the session UI's task.result returns the whole remainder.
    const page = (id, offset = 0, whole = false) => {
      const end = whole ? text.length : Math.min(text.length, offset + 16000);
      return { id, taskId: 'task', runId: id, status: 'completed', report: text.slice(offset, end), reportKind: 'partial',
        offset, totalLength: text.length, truncated: end < text.length, nextOffset: end < text.length ? end : null };
    };
    const root = createRoot(document.getElementById('root'));
    window.renderReport = (id = 'original') => root.render(h(TaskReportBody, { scope, report: page(id) }));
    window.calls = [];
    window.transport = async (op, params, target) => {
      window.calls.push({ op, params, target });
      if (window.rejectNext) { window.rejectNext = false; throw Error('模拟读取失败'); }
      if (window.holdNext) { window.holdNext = false; await new Promise(resolve => window.release = resolve); }
      return page(params.resultId, params.offset, true);
    };
  ` },
  bundle: true, write: false, format: "iife", platform: "browser", loader: { ".svg": "text", ".css": "empty" },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "report-transport", setup(builder) {
    builder.onResolve({ filter: /transport\.js$/ }, args => args.importer.endsWith("TaskReportBody.tsx") ? { path: "report-transport", namespace: "fixture" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const command = (...args) => window.transport(...args);", loader: "js" }));
  } }],
});
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const full = "完整证据。".repeat(4000) + "报告最后一行";
  // A truncated tool page loads the remainder automatically; there is no paging control.
  await page.evaluate(() => { (window as any).rejectNext = true; (window as any).renderReport(); });
  await page.getByText("部分成果", { exact: true }).waitFor();
  await page.getByRole("alert").waitFor();
  assert.match(await page.getByRole("alert").innerText(), /模拟读取失败/);
  assert.equal(await page.getByRole("button", { name: /继续读取/ }).count(), 0, "no continue-reading control");
  await page.getByRole("alert").getByRole("button", { name: "重新加载", exact: true }).click();
  await page.getByRole("status").waitFor({ state: "detached" });
  assert.equal(await page.locator(".markdown").innerText(), full);
  const calls = await page.evaluate(() => (window as any).calls);
  assert.deepEqual(calls.map((call: any) => [call.op, call.params.resultId, call.params.offset, call.params.limit]),
    [["task.result", "original", 16000, undefined], ["task.result", "original", 16000, undefined]]);
  assert.ok(calls.every((call: any) => call.target.sessionId === "parent"));
  // A late response for a replaced result never appends to the newer one.
  await page.evaluate(() => { (window as any).holdNext = true; (window as any).renderReport("older"); });
  await page.waitForFunction(() => typeof (window as any).release === "function");
  await page.evaluate(() => (window as any).renderReport("newer"));
  await page.waitForFunction((text) => document.querySelector(".markdown")?.textContent === text, full);
  await page.evaluate(() => (window as any).release());
  await page.waitForTimeout(100);
  assert.equal(await page.locator(".markdown").innerText(), full);
  assert.equal(await page.getByRole("status").count(), 0);
  assert.deepEqual(errors, []);
  console.log("PASS: full report without paging controls, exact reconstruction, retry, immutable identity, scope and stale response isolation.");
} finally { await browser.close(); }
