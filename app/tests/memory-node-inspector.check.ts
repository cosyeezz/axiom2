// Real metadata-only inspector + projection, isolated temporary build and port.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { build } from "vite";
import { chromium } from "playwright";
const root = mkdtempSync(join(tmpdir(), "axiom-memory-inspector-"));
const output = resolve(process.env.AXIOM_TEST_ARTIFACTS ?? "/tmp/axiom-memory-inspector-final"); mkdirSync(output, { recursive: true });
await build({ configFile: false, root: resolve("src/client"), logLevel: "warn", define: { "process.env.NODE_ENV": '"production"' }, build: { outDir: root, emptyOutDir: true, lib: { entry: resolve("tests/fixtures/memory-node-inspector.tsx"), name: "MemoryInspectorFixture", formats: ["iife"], fileName: "fixture" } } });
const files = readdirSync(root), script = files.find(file => file.endsWith(".js"))!, css = files.find(file => file.endsWith(".css"))!;
writeFileSync(join(root, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/${css}"></head><body><div id="root"></div><script src="/${script}"></script></body></html>`);
const server = createServer((req, res) => {
  const file = req.url === "/" ? "index.html" : basename(new URL(req.url!, "http://fixture").pathname);
  if (![...files, "index.html"].includes(file)) { res.writeHead(404).end(); return; }
  res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html"); res.end(readFileSync(join(root, file)));
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors: string[] = [], requests: string[] = [];
  page.on("pageerror", error => errors.push(error.message)); page.on("request", request => requests.push(request.url()));
  await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
  const inspector = page.getByRole("complementary", { name: "记忆详情" }), list = inspector.locator(".memory-document-list li");
  await inspector.getByText("关联文档 · 10 份", { exact: true }).waitFor(); assert.equal(await list.count(), 10, "real projection deduplicates identical composite identities");
  await inspector.getByText("工程实践 / 多文档节点", { exact: true }).waitFor();
  const source = inspector.locator(".memory-node-sources"), original = source.getByRole("button", { name: "查看原始目的记忆", exact: true });
  assert.equal(await source.getAttribute("open"), null); assert.equal(await original.first().isVisible(), false);
  await source.locator("summary").click(); assert.equal(await original.count(), 2); assert.equal(await original.first().isVisible(), true);
  await source.locator("summary").click(); assert.equal(await original.first().isVisible(), false);
  const requested = page.getByLabel("已请求打开");
  for (const [name, sessionId] of [["主要来源", "primary"], ["另一来源", "secondary"]] as const) {
    await inspector.getByRole("button", { name: `打开 共用资料，${name}`, exact: true }).click();
    assert.deepEqual(JSON.parse(await requested.innerText()), { scope: { workspaceId: "workspace", sessionId }, path: "details/共用资料.md" });
  }
  const filter = inspector.getByLabel("筛选关联文档"), before = requests.length;
  for (const [text, count] of [["  另一来源  ", 1], ["details/备忘3.md", 1], ["备忘", 8], ["does-not-exist", 0], ["", 10]] as const) {
    await filter.fill(text); assert.equal(await list.count(), count);
    if (!count) await inspector.getByText("没有符合筛选条件的文档。", { exact: true }).waitFor();
  }
  assert.equal(requests.length, before, "filtering is local and performs no RPC/model calls");
  await page.screenshot({ path: join(output, "inspector-documents.png") });
  await page.getByRole("button", { name: "查看无文件分类", exact: true }).click();
  await inspector.getByText("此节点暂无直接关联文档，可继续查看子节点。", { exact: true }).waitFor();
  assert.equal(await inspector.getByLabel("筛选关联文档").count(), 0); assert.equal(await list.count(), 0);
  assert.deepEqual(errors, []); console.log("PASS inspector: real composite dedup, distinct sessions with same path, scoped open, local title/path/source filtering, no-result/reset, collapsed purposes, empty category. No backend/model calls.");
} finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
