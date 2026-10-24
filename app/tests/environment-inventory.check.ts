import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { build } from "vite";
import { chromium } from "playwright";
import type { EnvironmentInventory } from "../src/shared/environment-inventory.js";

const root = mkdtempSync(join(tmpdir(), "axiom-environment-ui-"));
const artifacts = resolve(process.env.AXIOM_TEST_ARTIFACTS ?? "test-results/environment-inventory");
mkdirSync(artifacts, { recursive: true });
await build({ configFile: false, root: resolve("src/client"), logLevel: "warn", define: { "process.env.NODE_ENV": '"production"' }, build: { outDir: root, emptyOutDir: true, target: "safari15", minify: false, lib: { entry: resolve("tests/fixtures/environment-inventory.tsx"), name: "EnvironmentFixture", formats: ["iife"], fileName: "fixture" } } });
const files = readdirSync(root), js = files.find(file => file.endsWith(".js"))!, css = files.find(file => file.endsWith(".css"))!;
writeFileSync(join(root, "index.html"), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/${css}"></head><body><div id="root"></div><script src="/${js}"></script></body></html>`);
const server = createServer((req, res) => {
  const file = req.url === "/" ? "index.html" : basename(new URL(req.url!, "http://fixture").pathname);
  if (![...files, "index.html"].includes(file)) { res.writeHead(404).end(); return; }
  res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html; charset=utf-8");
  res.end(readFileSync(join(root, file)));
});
await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const inventory: EnvironmentInventory = {
  root: "/Users/example/" + "very-long-installation-directory-".repeat(10), entries: 3, elapsedMs: 12, pathIncomplete: true,
  items: [
    { id: "opencli", label: "OpenCLI", state: "detected", note: "发现文件不代表可删除。", locations: [{ path: "/private/" + "long-component-name-".repeat(20), purpose: "程序与旧版本", state: "present", bytes: 4096, files: 3, links: 1, complete: false, issues: ["达到扫描数量或时间上限，大小仅为已读取部分"] }] },
    { id: "rea", label: "REA", state: "unknown", note: "目录归属未核实。", locations: [{ path: "/unknown/rea", purpose: "主程序", state: "unknown", bytes: 0, files: 0, links: 0, complete: false, issues: ["无法读取"] }] },
    { id: "rtk", label: "RTK", state: "missing", note: "已知目录不存在。", locations: [{ path: "/absent/rtk", purpose: "程序", state: "missing", bytes: 0, files: 0, links: 0, complete: true, issues: [] }] },
  ],
  residuals: { complete: false, issues: ['清单达到枚举上限'], items: [{ path: '/fixture/setup/task/axiom2.tgz', purpose: '首次安装下载归档', state: 'present', bytes: 7, files: 1, links: 0, complete: true, issues: [], automaticRemovalAllowed: false, retention: '保留：未核实任务归属、恢复用途和进程占用，不可自动删除' }] },
  commands: [{ command: "pi", path: "/bin/pi", link: true }, { command: "pi", path: "/other/bin/pi", link: false }],
  notes: ["本次仅检查已知目录；不能据此判断环境无冲突。"],
};
const errors: string[] = [];
try {
  const page = await browser.newPage(); page.on("pageerror", error => errors.push(error.message));
  // tsx emits this helper for nested named fixture callbacks.
  await page.addInitScript({ content: "window.__name = value => value;" });
  await page.addInitScript(() => {
    const host = window as any;
    host.scanFixture = { calls: [] as string[], scanRequests: [] as any[], pending: null };
    host.__TAURI_INTERNALS__ = { invoke: (command: string, args: any) => {
      host.scanFixture.calls.push(command);
      host.scanFixture.scanRequests.push(args);
      if (command !== "axiom_environment") return Promise.reject(Error("Unexpected mutating command"));
      return new Promise((resolve, reject) => { host.scanFixture.pending = { resolve, reject }; });
    } };
  });
  await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
  const initial = page.getByRole("button", { name: "扫描安装与残留" });
  await initial.waitFor();
  assert.deepEqual(await page.evaluate(() => (window as any).scanFixture.calls), [], "mount does not scan automatically");
  await initial.click();
  const busy = page.getByRole("button", { name: "正在扫描…" });
  assert.equal(await busy.isDisabled(), true);
  await busy.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  assert.equal(await page.evaluate(() => (window as any).scanFixture.calls.length), 1, "busy interaction cannot start another scan");
  await page.evaluate(data => (window as any).scanFixture.pending.resolve(data), inventory);
  await page.getByRole("button", { name: "重新扫描" }).waitFor();
  assert.match(await page.getByRole("status").innerText(), /发现 1 类文件，2 项有未核实内容/);
  for (const summary of await page.locator(".environment-item summary").all()) await summary.click();
  await page.getByText("部分 PATH 位置未能扫描；缺少结果不代表未安装。", { exact: true }).waitFor();
  assert.match(await page.locator(".environment-locations").first().innerText(), /已读取 4 KB/);
  assert.equal(await page.getByText("已知位置未发现", { exact: true }).count(), 1);
  for (const theme of ["dark", "light"]) {
    await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
    for (const width of [320, 390, 1200]) {
      await page.setViewportSize({ width, height: 850 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme}/${width}: page has no horizontal overflow`);
      await page.screenshot({ path: join(artifacts, `inventory-${theme}-${width}.png`), fullPage: true });
    }
  }
  await page.getByRole("button", { name: "重新扫描" }).click();
  await page.evaluate(() => (window as any).scanFixture.pending.reject(Error("扫描超时")));
  await page.getByRole("alert").waitFor();
  assert.match(await page.getByRole("alert").innerText(), /扫描超时.*保留上次结果/);
  assert.equal(await page.getByRole("status").count(), 1, "failed rescan retains previous data with warning");
  await page.getByRole("button", { name: "重新扫描" }).click();
  await page.evaluate(() => (window as any).scanFixture.pending.resolve(null));
  await page.getByText(/扫描结果不完整，请重新扫描/).waitFor();
  await page.getByRole("button", { name: "重新扫描" }).click();
  await page.evaluate(data => (window as any).scanFixture.pending.resolve({ ...data, items: [], commands: [], pathIncomplete: false }), inventory);
  await page.getByRole("button", { name: "重新扫描" }).waitFor();
  assert.equal(await page.getByRole("alert").count(), 0);
  assert.match(await page.getByRole("status").innerText(), /发现 0 类文件/);
  assert.doesNotMatch(await page.getByRole("status").innerText(), /环境已干净|清理完成/);
  assert.deepEqual(await page.evaluate(() => (window as any).scanFixture.calls), Array(4).fill("axiom_environment"));
  const selected = page.getByRole('region', { name: '指定旧目录只读扫描' });
  await selected.getByLabel('旧目录完整路径').fill('/fixture/old-installation');
  await selected.getByRole('button', { name: '只读扫描指定目录' }).click();
  assert.equal(await selected.getByLabel('旧目录完整路径').isDisabled(), true);
  await page.evaluate(data => (window as any).scanFixture.pending.resolve(data), inventory);
  await selected.getByText(/指定目录扫描范围不一致/).waitFor();
  await selected.getByRole('button', { name: '只读扫描指定目录' }).click();
  const selectedResult = { ...inventory, root: '/fixture/old-installation', scope: 'selected', origin: 'unknown', automaticRemovalAllowed: false, commands: [] };
  await page.evaluate(data => (window as any).scanFixture.pending.resolve(data), selectedResult);
  await selected.getByText('安装来源未核实 · 禁止自动删除', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => (window as any).scanFixture.scanRequests.slice(-2)), [{ root: '/fixture/old-installation' }, { root: '/fixture/old-installation' }]);
  assert.equal(await selected.getByRole('button').count(), 1, 'selected results have only read-only scan');
  await page.getByRole('button', { name: '重新扫描', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => (window as any).scanFixture.scanRequests.at(-1)), {}, 'current rescan never takes selected root');
  await page.evaluate(data => (window as any).scanFixture.pending.resolve(data), inventory);
  await page.getByRole('button', { name: '重新扫描', exact: true }).waitFor();
  assert.match(await selected.innerText(), /\/fixture\/old-installation/);
  await selected.getByLabel('旧目录完整路径').fill('/fixture/other');
  assert.equal(await selected.getByText('安装来源未核实 · 禁止自动删除', { exact: true }).count(), 0, 'editing path invalidates previous result');
  for (const partial of [{ items: [null] }, { items: [{ ...inventory.items[0], locations: [{}] }] }, { residuals: { items: [null], complete: true, issues: [] } }]) {
    await selected.getByRole('button', { name: '只读扫描指定目录' }).click();
    await page.evaluate(data => (window as any).scanFixture.pending.resolve(data), { ...selectedResult, ...partial });
    await selected.getByText('扫描结果不完整，请重新扫描。', { exact: true }).waitFor();
  }
  const residuals = page.getByRole('group', { name: '安装残留逐项清单' });
  assert.match(await residuals.innerText(), /未核实任务归属/);
  assert.equal(await residuals.getByRole('button').count(), 0);
  // All destructive interactions below use an in-memory native bridge fixture.
  await page.evaluate(() => {
    const host = window as any;
    const f = host.scanFixture;
    f.mutations = []; f.requests = []; f.snapshot = { revision: 'r', version: '1.0.0', executable: '/fixture/rtk', offline: true, cleanupPaths: ['/fixture/versions/current', '/fixture/versions/previous'] };
    f.service = null;
    host.__TAURI_INTERNALS__.invoke = (command: string, args: any) => {
      f.calls.push(command);
      if (command === 'axiom_environment') return new Promise((resolve, reject) => { f.pending = { resolve, reject }; });
      if (command === 'axiom_cleanup') {
        const request = args.request; f.requests.push(request.op);
        if (request.op.endsWith('.get')) return Promise.resolve({ requestId: request.requestId, data: request.op === 'rtk.get' ? f.snapshot : request.op === 'rea.get' ? f.reaSnapshot || { revision: 'r' } : request.op === 'resources.get' ? { revision: 'r', items: [], scopes: [], warnings: [] } : request.op === 'modelProxy.get' ? { revision: 'r', installations: {} } : { revision: 'r' } });
        f.mutations.push(request);
        if (request.op === 'rea.clearDownloads') {
          f.reaSnapshot = { ...f.reaSnapshot, jobs: [{ id: 'download-job', kind: 'clearDownloads', engine: request.params.engine, running: false, message: 'selected package cleared' }], downloadCleanup: { ...f.reaSnapshot.downloadCleanup, [request.params.engine]: { paths: [], revision: 'e'.repeat(64) } } };
          return Promise.resolve({ requestId: request.requestId, data: f.reaSnapshot });
        }
        return Promise.reject(Error('模拟响应丢失'));
      }
      if (command === 'axiom_update') {
        if (args.action === 'service-remove-preview') {
          const task = { id: 'fixture-service', attemptId: 'a', endpoint: 'desktop', scope: '当前电脑', resource: 'service-remove-preview', label: '后台卸载预览', action: 'check', status: 'succeeded', phase: 'checking', steps: ['checking'], completedSteps: 1, createdAt: 1, updatedAt: 2, budgets: { headersMs: 30000, idleMs: 60000, installMs: 600000, totalMs: 1200000 }, capabilities: { cancel: false, extend: false } };
          f.service = { serviceRemoval: { token: 'preview', version: '1.0.0', packageRoot: '/fixture/service', items: [{ label: '后台程序', path: '/fixture/service', state: 'remove' }, { label: '用户数据', path: '/fixture/data', state: 'retain' }] }, job: { kind: 'service-remove-preview', running: false, message: '', task } };
        } else if (args.action === 'service-uninstall') {
          f.mutations.push(args);
          f.service = { ...f.service, serviceRemoval: { ...f.service.serviceRemoval, token: null }, job: { ...f.service.job, kind: 'service-uninstall', task: { ...f.service.job.task, id: 'fixture-service-remove', resource: 'service-uninstall', action: 'uninstall' }, cleanup: { complete: true, items: [{ label: '后台程序', path: '/fixture/service', state: 'removed' }, { label: '用户数据', path: '/fixture/data', state: 'retain' }] } } };
        } else if (args.action === 'archive-preview') {
          f.service = { archiveCleanup: { token: 'archive-preview', items: [{ id: 'fixture-archive', label: '后台下载归档', path: '/fixture/updates/archive.tgz', state: 'remove', size: 1024 }, { label: '其他安装空间与缓存', state: 'retain' }] }, job: { kind: 'archive-preview', running: false, task: { ...f.service.job.task, id: 'fixture-archive-preview', resource: 'archive-preview', label: '下载归档预览', action: 'check' } } };
        } else if (args.action === 'archive-remove') {
          f.mutations.push(args);
          f.service = { ...f.service, archiveCleanup: { ...f.service.archiveCleanup, token: null }, job: { ...f.service.job, kind: 'archive-remove', task: { ...f.service.job.task, id: 'fixture-archive-remove', resource: 'archive-remove', action: 'uninstall' }, cleanup: { complete: true, items: [{ label: '后台下载归档', path: '/fixture/updates/archive.tgz', state: 'removed' }, { label: '其他安装空间与缓存', state: 'retain' }] } } };
        } else if (args.action !== 'status') return Promise.reject(Error('unexpected update action'));
        return Promise.resolve(f.service);
      }
      return Promise.reject(Error('unexpected native command'));
    };
  });
  await page.getByRole('button', { name: '读取可卸载项目' }).click();
  const tools = page.getByRole('region', { name: '工具与资源卸载' });
  await tools.getByRole('button', { name: '查看只读范围' }).click();
  await tools.getByRole('group', { name: '确认工具清理范围' }).waitFor();
  assert.match(await tools.innerText(), /客户端内置维护程序/);
  assert.match(await tools.getByRole('group', { name: '确认工具清理范围' }).innerText(), /\/fixture\/versions\/previous/);
  assert.equal(await page.evaluate(() => (window as any).scanFixture.mutations.length), 0, 'preview does not delete');
  assert.equal(await tools.getByRole('button', { name: '确认清理所列范围' }).count(), 0, 'offline preview has no deletion control');
  assert.match(await tools.innerText(), /缺少历史工作进程退出证明/);
  await tools.getByRole('button', { name: '返回', exact: true }).click();
  await page.evaluate(() => { const f = (window as any).scanFixture; f.snapshot = { ...f.snapshot, offline: false, cleanup: { paths: f.snapshot.cleanupPaths, revision: 'd'.repeat(64) } }; });
  await tools.getByRole('button', { name: '读取可卸载项目' }).click();
  await tools.getByRole('button', { name: '查看卸载范围' }).click();
  await page.evaluate(() => { (window as any).scanFixture.snapshot.offline = true; });
  await tools.getByRole('button', { name: '确认清理所列范围' }).click();
  await tools.getByText('RTK 执行能力或范围已变化，请重新核实；未提交删除请求。', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => (window as any).scanFixture.mutations.length), 0, 'stale online preview cannot submit offline removal');
  assert.equal(await tools.getByRole('button', { name: '确认清理所列范围' }).count(), 0);
  await tools.getByRole('button', { name: '返回', exact: true }).click();
  await page.evaluate(() => { (window as any).scanFixture.snapshot.offline = false; });
  await tools.getByRole('button', { name: '读取可卸载项目' }).click();
  await tools.getByRole('button', { name: '查看卸载范围' }).click();
  await tools.getByRole('button', { name: '确认清理所列范围' }).click();
  await tools.getByText('模拟响应丢失', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => (window as any).scanFixture.mutations.length), 1);
  // A manual scan is already running when the unknown operation asks to rescan.
  const scanCount = await page.evaluate(() => (window as any).scanFixture.calls.filter((value: string) => value === 'axiom_environment').length);
  await page.getByRole('button', { name: '重新扫描', exact: true }).click();
  await tools.getByRole('button', { name: '重新核实与扫描' }).click();
  await page.evaluate(data => (window as any).scanFixture.pending.resolve(data), inventory);
  await page.waitForFunction(count => (window as any).scanFixture.calls.filter((value: string) => value === 'axiom_environment').length === count + 2, scanCount);
  await page.evaluate(data => (window as any).scanFixture.pending.resolve(data), inventory);
  await tools.getByText('已重新扫描本机已知安装与残留；请查看下方结果。', { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => (window as any).scanFixture.mutations.length), 1, 'unknown response never replays removal');
  assert.match(await tools.innerText(), /尚未完成核实/);
  const backend = page.getByRole('region', { name: '托管后台卸载' });
  await backend.getByRole('button', { name: '预览后台卸载' }).click();
  await backend.getByRole('button', { name: '卸载此后台', exact: true }).click();
  const confirmation = backend.getByRole('button', { name: '确认卸载后台', exact: true });
  assert.equal(await confirmation.isDisabled(), true);
  await backend.getByRole('checkbox').check();
  await confirmation.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await page.waitForFunction(() => (window as any).scanFixture.mutations.length === 2);
  assert.deepEqual(await page.evaluate(() => JSON.parse((window as any).scanFixture.mutations[1].version)), { token: 'preview', confirm: true });
  await page.getByRole('button', { name: '正在扫描…', exact: true }).waitFor();
  await page.evaluate(data => (window as any).scanFixture.pending.resolve(data), inventory);
  await backend.getByText('已移除', { exact: true }).waitFor();
  assert.match(await backend.innerText(), /保留/);
  assert.equal(await page.evaluate(() => (window as any).scanFixture.mutations.length), 2, 'double click submits one backend removal');
  const archives = page.getByRole('region', { name: '下载归档清理' });
  await archives.getByRole('button', { name: '预览下载归档' }).click();
  await archives.getByRole('button', { name: '清理此归档', exact: true }).click();
  await archives.getByRole('group', { name: '确认归档清理' }).waitFor();
  assert.equal(await page.evaluate(() => (window as any).scanFixture.mutations.length), 2, 'archive preview is not deletion');
  await archives.getByRole('button', { name: '确认清理归档', exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await page.waitForFunction(() => (window as any).scanFixture.mutations.length === 3);
  assert.deepEqual(await page.evaluate(() => JSON.parse((window as any).scanFixture.mutations[2].version)), { token: 'archive-preview', id: 'fixture-archive', confirm: true });
  await page.getByRole('button', { name: '正在扫描…', exact: true }).waitFor();
  await page.evaluate(data => (window as any).scanFixture.pending.resolve(data), inventory);
  await archives.getByText('所选下载归档路径已移除。', { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => (window as any).scanFixture.mutations.length), 3, 'archive double click submits once');
  // Online previews must transmit the exact path identity digest through the desktop bridge.
  await tools.getByRole('button', { name: '关闭结果，重新选择项目' }).click();
  await page.evaluate(() => { const f = (window as any).scanFixture; f.snapshot = { ...f.snapshot, offline: false, cleanup: { paths: ['/fixture/versions/current', '/fixture/versions/previous'], revision: 'd'.repeat(64) } }; });
  await tools.getByRole('button', { name: '读取可卸载项目' }).click();
  await tools.getByRole('button', { name: '查看卸载范围' }).click();
  assert.match(await tools.getByRole('group', { name: '确认工具清理范围' }).innerText(), /\/fixture\/versions\/previous/);
  await tools.getByRole('button', { name: '确认清理所列范围' }).click();
  await tools.getByText('模拟响应丢失', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => (window as any).scanFixture.mutations[3].params.cleanupRevision), 'd'.repeat(64));
  // Data cleanup is independently previewed, and carries its own digest.
  await tools.getByRole('button', { name: '关闭结果，重新选择项目' }).click();
  await page.evaluate(() => {
    const f = (window as any).scanFixture;
    f.snapshot = { ...f.snapshot, dataCleanup: {
      stats: { count: 2, paths: ['/fixture/effects.sqlite'], retained: [], revision: 'a'.repeat(64) },
      originals: { count: 1, paths: ['/fixture/originals/owned.txt'], retained: ['/fixture/originals/unknown.txt'], revision: 'b'.repeat(64) },
    } };
  });
  await tools.getByRole('button', { name: '读取可卸载项目' }).click();
  const originals = tools.locator('.environment-cleanup-row').filter({ hasText: 'RTK 保留原文' });
  await originals.getByRole('button', { name: '查看数据清理范围' }).click();
  const dataPreview = tools.getByRole('group', { name: '确认工具清理范围' });
  assert.match(await dataPreview.innerText(), /旧回查路径将失效/);
  assert.match(await dataPreview.innerText(), /unknown\.txt/);
  assert.match(await dataPreview.innerText(), /另一类数据保留/);
  assert.equal(await page.evaluate(() => (window as any).scanFixture.mutations.length), 4);
  await tools.getByRole('button', { name: '确认清理所列范围' }).click();
  await tools.getByText('模拟响应丢失', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => {
    const request = (window as any).scanFixture.mutations[4];
    return { op: request.op, params: request.params };
  }), { op: 'rtk.cleanupOriginals', params: { cleanupRevision: 'b'.repeat(64), revision: 'r', confirm: true } });
  await tools.getByRole('button', { name: '关闭结果，重新选择项目' }).click();
  await page.evaluate(() => {
    (window as any).scanFixture.reaSnapshot = { revision: 'download-revision', downloadCleanup: {
      ghidra: { paths: ['/fixture/downloads/ghidra-owned'], revision: 'c'.repeat(64) },
    }, downloadCleanupErrors: { hopper: '下载目录缺少有效的原始维护归属证明，已保留文件；不会自动重新登记目录。' } };
  });
  await tools.getByRole('button', { name: '读取可卸载项目' }).click();
  const unprovenDownload = tools.locator('.environment-cleanup-row').filter({ hasText: 'Hopper 登记下载包' });
  assert.equal(await unprovenDownload.getByRole('button', { name: '当前不可自动清理' }).isDisabled(), true);
  assert.match(await unprovenDownload.innerText(), /原始维护归属证明/);
  await tools.locator('.environment-cleanup-row').filter({ hasText: 'Ghidra 登记下载包' }).getByRole('button', { name: '查看数据清理范围' }).click();
  assert.match(await tools.getByRole('group', { name: '确认工具清理范围' }).innerText(), /交给系统安装器的副本保留/);
  await tools.getByRole('button', { name: '确认清理所列范围' }).click();
  await page.getByRole('button', { name: '正在扫描…', exact: true }).waitFor();
  await page.evaluate(data => (window as any).scanFixture.pending.resolve(data), inventory);
  await tools.getByText('REA · Ghidra 登记下载包 · 选定范围已核实', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => (window as any).scanFixture.mutations[5].params), { engine: 'ghidra', cleanupRevision: 'c'.repeat(64), revision: 'download-revision', confirm: true });
  assert.match(await tools.innerText(), /hopper-owned|Hopper 登记下载包/);
  assert.match(await archives.innerText(), /保留/);
  assert.doesNotMatch(await archives.innerText(), /环境已干净/);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, artifacts, cases: ["offline RTK only previews without deletion", "stale online RTK confirmation rejects offline transition", "unproven download disabled independently", "registered REA download confirmation and rescan", "independent data scope, retention and digest", "nested malformed data rejected", "selected scope mismatch rejected", "selected result isolated from current cleanup", "residual rows never authorize deletion", "online path confirmation digest", "archive confirmation, double click and rescan", "explicit read-only scan", "busy protection", "unknown and partial results", "dark/light 320/390/1200", "failure retains prior results", "malformed result", "rescan recovery", "no clean-environment claim", "offline tool paths and consent", "lost receipt stays unknown without replay", "rescan queued after current scan", "backend confirmation and double click protection", "backend removal rescan"] }));
} finally {
  await browser.close(); await new Promise<void>(done => server.close(() => done())); rmSync(root, { recursive: true, force: true });
}
