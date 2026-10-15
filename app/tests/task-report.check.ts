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
    const page = (id, offset = 0) => ({ id, taskId: 'task', runId: id, status: 'completed',
      report: text.slice(offset, offset + 16000), reportKind: 'partial', offset, totalLength: text.length,
      truncated: offset + 16000 < text.length, nextOffset: offset + 16000 < text.length ? offset + 16000 : null });
    const root = createRoot(document.getElementById('root'));
    window.renderReport = (id = 'original') => root.render(h(TaskReportBody, { scope, report: page(id) }));
    window.calls = [];
    window.transport = async (op, params, target) => {
      window.calls.push({ op, params, target });
      if (window.rejectNext) { window.rejectNext = false; throw Error('模拟读取失败'); }
      if (window.holdNext) { window.holdNext = false; await new Promise(resolve => window.release = resolve); }
      return page(params.resultId, params.offset);
    };
    window.renderReport();
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
  await page.getByText("部分成果", { exact: true }).waitFor();
  await page.evaluate(() => { (window as any).rejectNext = true; });
  await page.getByRole("button", { name: /继续读取/ }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByRole("alert").innerText(), "模拟读取失败");
  await page.getByRole("button", { name: /继续读取/ }).click();
  await page.getByRole("button", { name: /继续读取/ }).waitFor({ state: "detached" });
  assert.equal(await page.locator(".markdown").innerText(), "完整证据。".repeat(4000) + "报告最后一行");
  const calls = await page.evaluate(() => (window as any).calls);
  assert.deepEqual(calls.map((call: any) => [call.op, call.params.resultId, call.params.offset]), [["task.result", "original", 16000], ["task.result", "original", 16000]]);
  assert.ok(calls.every((call: any) => call.target.sessionId === "parent"));
  await page.evaluate(() => { (window as any).renderReport("older"); (window as any).holdNext = true; });
  await page.getByRole("button", { name: /继续读取/ }).click();
  await page.evaluate(() => (window as any).renderReport("newer"));
  await page.evaluate(() => (window as any).release());
  await page.getByRole("button", { name: /继续读取/ }).waitFor();
  assert.equal(await page.locator(".markdown").innerText(), "完整证据。".repeat(3200));
  assert.deepEqual(errors, []);
  console.log("PASS: report pagination, exact reconstruction, retry, immutable identity, scope and stale response isolation.");
} finally { await browser.close(); }
