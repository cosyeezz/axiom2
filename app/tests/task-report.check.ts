// Render complete immutable results in Chromium; no follow-up transport is needed.
// Run: node --import tsx tests/task-report.check.ts
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const bundle = await build({
  stdin: { resolveDir: resolve("."), loader: "tsx", contents: `
    import { createElement as h } from 'react';
    import { createRoot } from 'react-dom/client';
    import { TaskReportBody } from './src/client/tasks/TaskReportBody.tsx';
    import { Markdown } from './src/client/chat/Markdown.tsx';
    import { FilePreviewContext } from './src/client/chat/FileLink.tsx';
    import { LocalPath } from './src/client/LocalPath.tsx';
    const scope = { workspaceId: 'workspace', sessionId: 'parent' };
    const root = createRoot(document.getElementById('root'));
    window.renderReport = (id, report, reportKind = 'final') => root.render(h(TaskReportBody, { scope,
      report: { id, taskId: 'task', runId: id, status: 'completed', report, reportKind } }));
    window.renderPaths = () => {
      const source = '清单[第44行](docs/checklist.md#L44)；源码[第48行](src/example.ts#L48)。';
      const code = '路径：\u0060./docs/checklist.md\u0060，后续文字。';
      root.render(h('main', { className: 'thread-content' },
        h('section', { id: 'report', className: 'task-operation' },
          h('div', { className: 'task-call-detail task-report' }, h(TaskReportBody, { scope,
            report: { id: 'paths', status: 'completed', reportKind: 'final', report: source + '\\n\\n' + code } }))),
        h('section', { id: 'reply', className: 'markdown' }, h(Markdown, { text: source + '\\n\\n' + code, pathScope: scope })),
        h('section', { id: 'preview', className: 'markdown file-reading' }, h(Markdown, { text: source, pathScope: scope, sourceFile: '/tmp/report.md' })),
        h(FilePreviewContext.Provider, { value: (reference) => { window.openedFile = reference.href; } },
          h('section', { id: 'file-link', className: 'markdown' }, h(Markdown, { text: source,
            images: { scope, messageId: 'reply' } }))),
        h('header', { id: 'outside' }, h(LocalPath, { path: '/tmp/workspace', scope })),
      ));
    };
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
  const html = '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>';
  const styles = ['tokens', 'workbench', 'chat', 'local-path', 'task-calls', 'process-motion', 'file-preview', 'inline-code', 'mobile']
    .map(name => readFileSync(`src/client/styles/${name}.css`, 'utf8')).join('\n');
  await page.setContent(html);
  await page.addStyleTag({ content: styles });
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

  await page.evaluate(() => (window as any).renderPaths());
  await page.locator('#report .local-path').first().waitFor();
  const artifacts = resolve(process.env.AXIOM_REPORT_ARTIFACTS || 'test-results/task-report');
  mkdirSync(artifacts, { recursive: true });
  for (const touch of [false, true]) {
    // Exercise the same coarse-pointer rules without changing the renderer.
    const context = touch ? await browser.newContext({ hasTouch: true, isMobile: true }) : null;
    const current = context ? await context.newPage() : page;
    if (context) {
      current.on('pageerror', error => errors.push(error.message));
      await current.setContent(html);
      await current.addStyleTag({ content: styles });
      await current.addScriptTag({ content: bundle.outputFiles[0].text });
      await current.evaluate(() => (window as any).renderPaths());
      await current.locator('#report .local-path').first().waitFor();
    }
    try {
      for (const width of [390, 820, 1440]) {
        await current.setViewportSize({ width, height: 1000 });
        const measurements = await current.locator('section .markdown .local-path, section.markdown .local-path').evaluateAll(elements => elements.map(element => {
          const text = element.querySelector('.local-path-text code, .local-path-text, .file-reference > span')!;
          const outer = document.createElement('i'), inner = document.createElement('i');
          for (const marker of [outer, inner]) marker.style.cssText = 'display:inline-block;width:0;height:0;padding:0;margin:0;border:0;vertical-align:baseline';
          element.before(outer); text.prepend(inner);
          const result = { text: text.textContent, outer: outer.getBoundingClientRect().top, inner: inner.getBoundingClientRect().top };
          outer.remove(); inner.remove();
          return result;
        }));
        assert.equal(measurements.length, 10, 'report, reply, document and clickable file paths are covered');
        for (const result of measurements) assert.ok(Math.abs(result.outer - result.inner) < 0.1,
          `baseline ${touch ? 'touch' : 'desktop'}-${width}: ${JSON.stringify(result)}`);
        assert.equal(await current.locator('#outside .local-path').evaluate(node => getComputedStyle(node).verticalAlign), 'middle', 'non-Markdown path controls keep their alignment');
        assert.equal(await current.locator('section .path-actions').count(), 0, 'body references do not gain copy/open controls');
        assert.equal(await current.locator('#outside .path-actions button').count(), 2, 'header path actions are preserved');
        assert.ok(await current.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no overflow at ${width}`);
        await current.screenshot({ path: resolve(artifacts, `${touch ? 'touch' : 'desktop'}-${width}.png`), fullPage: true });
      }
      await current.locator('#file-link .file-reference').first().click();
      assert.equal(await current.evaluate(() => (window as any).openedFile), 'docs/checklist.md#L44', 'file preview links remain clickable');
    } finally { await context?.close(); }
  }
  assert.deepEqual(errors, []);
  console.log(`PASS: immutable full reports; Markdown path baselines in reports, replies and previews; file link clicks; unchanged header actions; desktop/touch at 390/820/1440. Artifacts: ${artifacts}`);
} finally { await browser.close(); }
