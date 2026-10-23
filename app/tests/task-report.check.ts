// Render complete immutable results in Chromium; no follow-up transport is needed.
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
    const scope = { workspaceId: 'workspace', sessionId: 'parent' };
    const root = createRoot(document.getElementById('root'));
    window.renderReport = (id, report, reportKind = 'final') => root.render(h(TaskReportBody, { scope,
      report: { id, taskId: 'task', runId: id, status: 'completed', report, reportKind } }));
    window.calls = [];
    window.transport = (...args) => { window.calls.push(args); throw Error('Unexpected result continuation'); };
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
  await page.evaluate(text => (window as any).renderReport("original", text, "partial"), full);
  await page.getByText("部分成果", { exact: true }).waitFor();
  assert.equal(await page.locator(".markdown").innerText(), full);
  assert.equal(await page.getByRole("button", { name: /继续读取|重新加载/ }).count(), 0);
  await page.evaluate(() => (window as any).renderReport("newer", "新的短结果"));
  await page.getByText("新的短结果", { exact: true }).waitFor();
  assert.equal(await page.locator(".markdown").innerText(), "新的短结果");
  await page.evaluate(text => (window as any).renderReport("original", text, "partial"), full);
  await page.getByText("部分成果", { exact: true }).waitFor();
  assert.equal(await page.locator(".markdown").innerText(), full);
  assert.deepEqual(await page.evaluate(() => (window as any).calls), []);
  assert.deepEqual(errors, []);
  console.log("PASS: long and short reports render in full, immutable results can be selected repeatedly, no pagination requests.");
} finally { await browser.close(); }
