// Real production updater worker + Windows process supervision + real npm root.
// The browser transport is an HTTP test adapter, NOT Tauri/WebView2 acceptance.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { chromium } from 'playwright';
const root = mkdtempSync(join(tmpdir(), 'axiom-pi-real-helper-'));
const dist = join(root, 'dist'), data = join(root, 'data'), prefix = join(root, 'isolated ! & npm');
const artifacts = resolve(process.env.AXIOM_TEST_ARTIFACTS ?? 'test-results/pi-removal-native-helper');
for (const path of [dist, data, artifacts]) mkdirSync(path, { recursive: true });
const npmrc = join(root, 'empty-user.npmrc'), globalNpmrc = join(root, 'empty-global.npmrc');
writeFileSync(npmrc, ''); writeFileSync(globalNpmrc, '');
const updater = process.env.AXIOM_TEST_UPDATER ?? fileURLToPath(new URL('../desktop/updater.mjs', import.meta.url));
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toLowerCase().startsWith('npm_config_'))), AXIOM_DATA_DIR: data, NPM_CONFIG_PREFIX: prefix, NPM_CONFIG_CACHE: join(root, 'npm-cache'), NPM_CONFIG_USERCONFIG: npmrc, NPM_CONFIG_GLOBALCONFIG: globalNpmrc };
const calls: any[] = [];
async function invoke(action: string) {
  assert.ok(['status', 'pi-remove-preview'].includes(action), `unauthorized action ${action}`);
  return new Promise<any>((done, reject) => {
    const child = spawn(process.execPath, [updater, action], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk);
    child.on('error', reject);
    child.on('close', code => {
      try { assert.equal(code, 0, stderr || stdout); const value = JSON.parse(stdout.trim()); calls.push({ action, exitCode: code, stderr, taskId: value.job?.task?.id, taskStatus: value.job?.task?.status, running: value.job?.running }); assert.notEqual(value.state, 'error', value.message); done(value); }
      catch (error) { reject(error); }
    });
  });
}
await build({ configFile: false, root: resolve('src/client'), logLevel: 'warn', define: { 'process.env.NODE_ENV': '"production"' }, build: { outDir: dist, emptyOutDir: true, target: 'safari15', minify: false, lib: { entry: resolve('tests/fixtures/pi-removal.tsx'), name: 'PiRemovalFixture', formats: ['iife'], fileName: 'fixture' } } });
const files = readdirSync(dist), js = files.find(file => file.endsWith('.js'))!, css = files.find(file => file.endsWith('.css'))!;
writeFileSync(join(dist, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/${css}"><body><div id="root"></div><script src="/${js}"></script></body></html>`);
const server = createServer(async (req, res) => {
  if (req.url === '/native' && req.method === 'POST') {
    try {
      let body = ''; for await (const chunk of req) { body += chunk; assert.ok(body.length < 4096); }
      const input = JSON.parse(body); assert.equal(input.command, 'axiom_update'); assert.equal(input.args.version, null);
      const value = await invoke(input.args.action); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value));
    } catch (error) { res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: String(error) })); }
    return;
  }
  const name = req.url === '/' ? 'index.html' : basename(new URL(req.url!, 'http://fixture').pathname);
  if (![...files, 'index.html'].includes(name)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
  res.end(readFileSync(join(dist, name)));
});
await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER, headless: true });
const errors: string[] = [];
try {
  const page = await browser.newPage(); page.setDefaultTimeout(45000); page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript({ content: 'window.__name = value => value;' });
  await page.addInitScript(() => {
    (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string, args: unknown) => {
      const response = await fetch('/native', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command, args }) });
      const value = await response.json(); if (!response.ok) throw Error(value.error); return value;
    } };
  });
  await page.goto(`http://127.0.0.1:${(server.address() as any).port}/`);
  const section = page.getByRole('region', { name: '终端 Pi 卸载' });
  await section.getByRole('button', { name: '读取清理任务', exact: true }).click();
  await section.getByRole('status').filter({ hasText: '暂无终端 Pi 卸载任务' }).waitFor();
  assert.equal(await section.getByRole('button', { name: '卸载此终端 Pi', exact: true }).count(), 0);
  await section.getByRole('button', { name: '预览 Pi 卸载', exact: true }).click();
  await section.getByRole('status').filter({ hasText: '所选 npm 中未安装终端 Pi，无需卸载；此结果不代表其他命令来源也未安装。' }).waitFor();
  assert.equal(await section.getByRole('alert').count(), 0);
  assert.equal(await section.getByRole('button', { name: '卸载此终端 Pi', exact: true }).count(), 0);
  assert.equal(await section.getByRole('group', { name: '确认 Pi 卸载' }).count(), 0);
  let state = await invoke('status');
  assert.equal(state.job.task.status, 'succeeded', state.job.message); assert.equal(state.pi.removal.token, null); assert.equal(state.pi.removal.installed, false);
  const task = state.job.task;
  const commandDirs = readdirSync(join(data, 'updates/tasks', task.id)).filter(name => name.startsWith('command-'));
  assert.equal(commandDirs.length, 1, 'exactly one actual npm inspection command');
  const request = JSON.parse(readFileSync(join(data, 'updates/tasks', task.id, commandDirs[0], 'request.json'), 'utf8'));
  const result = JSON.parse(readFileSync(join(data, 'updates/tasks', task.id, commandDirs[0], 'result.json'), 'utf8'));
  assert.equal(result.ok, true); assert.equal(result.output, join(prefix, process.platform === 'win32' ? 'node_modules' : 'lib/node_modules'));
  assert.equal(existsSync(prefix), false, 'preview never creates or installs into the selected prefix');
  await section.getByRole('button', { name: '读取清理任务', exact: true }).click();
  await section.getByRole('status').filter({ hasText: '所选 npm 中未安装终端 Pi，无需卸载；此结果不代表其他命令来源也未安装。' }).waitFor();
  for (const theme of ['dark', 'light']) for (const width of [360, 1200]) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme); await page.setViewportSize({ width, height: 850 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: join(artifacts, `empty-pi-${theme}-${width}.png`), fullPage: true });
  }
  await section.getByRole('button', { name: '预览 Pi 卸载', exact: true }).click();
  // Poll awaited Node promises: browser waitForFunction does not guarantee an
  // async predicate is repeatedly evaluated rather than treating its Promise as truthy.
  const deadline = Date.now() + 60000;
  do {
    state = await invoke('status');
    if (state.job?.task?.id !== task.id && state.job?.running === false && state.job?.task?.status === 'succeeded') break;
    await delay(250);
  } while (Date.now() < deadline);
  assert.notEqual(state.job.task.id, task.id, 'repeat preview owns a new task');
  assert.equal(state.job.running, false); assert.equal(state.job.task.status, 'succeeded'); assert.equal(state.pi.removal.token, null);
  assert.equal(existsSync(join(data, 'updates/process-owner.json')), false, 'native process owner released with supervisor receipts');
  assert.deepEqual(errors, []);
  writeFileSync(join(artifacts, 'result.json'), JSON.stringify({ passed: true, root, updater, realNpm: true, realWindowsSupervision: process.platform === 'win32', transport: 'HTTP test adapter; not Tauri/WebView2', calls, task, commandRequest: request, commandResult: result, productExeStarted: false, installOrUninstallRequested: false }, null, 2));
  console.log(JSON.stringify({ passed: true, root, artifacts, calls: calls.length, realNpm: true, realWindowsSupervision: process.platform === 'win32', productExeStarted: false }));
} catch (error) {
  writeFileSync(join(artifacts, 'failure.json'), JSON.stringify({ root, errors, calls, error: String(error) }, null, 2));
  for (const page of browser.contexts().flatMap(context => context.pages())) await page.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close(); await new Promise<void>(done => server.close(() => done()));
  // Retain isolated task/exit receipts, even on failure. Never infer tree exit from a missing PID.
}
