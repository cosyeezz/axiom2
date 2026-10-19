// Real Windows IPC smoke: isolated data, no installers and no daily service changes.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Browser } from 'playwright';
import { startServer } from '../src/server/index.js';
import { tailscaleAddresses } from '../src/server/remote-access.js';
assert.equal(process.platform, 'win32');
const ip = tailscaleAddresses().find(ip => !ip.includes(':'));
assert.ok(ip, 'This smoke requires an active local Tailscale IPv4 interface');
const root = await mkdtemp(join(tmpdir(), 'axiom-startup-native-'));
const data = join(root, 'client'); await mkdir(data);
const pi = join(root, 'pi'); await mkdir(pi);
process.env.AXIOM_PI_DIR = pi; process.env.PI_CODING_AGENT_DIR = pi;
const app = await startServer({ root: join(root, 'server'), port: 0, dev: true });
const targetPort = Number(new URL(app.origin).port);
let releaseLocalStatus: (() => void) | undefined;
let localMode: 'hold' | 'invalid' | 'redirect' | 'oversize' = 'hold';
const localProbe = createHttpServer((request, response) => {
  if (request.url === '/api/status') {
    if (localMode === 'invalid') { response.end('{"connected":false,"stage":1}'); return; }
    if (localMode === 'redirect') { response.writeHead(302, { Location: app.origin }); response.end(); return; }
    if (localMode === 'oversize') { response.end('x'.repeat(5000)); return; }
    releaseLocalStatus = () => { if (response.writableEnded || response.destroyed) return; response.setHeader('Content-Type', 'application/json'); response.end('{"connected":true,"stage":1}'); };
  } else { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><div class="app">Delayed direct fixture</div>'); }
});
await new Promise<void>(resolve => localProbe.listen(0, '127.0.0.1', resolve));
const localProbePort = (localProbe.address() as { port: number }).port;
const legacy = createHttpServer((request, response) => {
  if (request.url === '/api/status') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ connected: true, stage: 1 })); }
  else { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html><body style="background:#101214;color:#ddd"><div class="app"><h1>Legacy backend fixture</h1></div></body></html>'); }
});
await new Promise<void>(resolve => legacy.listen(0, ip, resolve));
const legacyPort = (legacy.address() as { port: number }).port;
const probe = createServer(); await new Promise<void>(r => probe.listen(0, '127.0.0.1', r));
const debugPort = (probe.address() as { port: number }).port; await new Promise<void>(r => probe.close(() => r()));
const native = spawn(resolve(process.env.AXIOM_DESKTOP_BINARY || 'Axiom2-ServiceTest.exe'), [], { env: { ...process.env, AXIOM_DATA_DIR: data, AXIOM_PORT: String(targetPort), WEBVIEW2_USER_DATA_FOLDER: join(root, 'webview'), AXIOM_DESKTOP_DEBUG_PORT: String(debugPort), AXIOM_DESKTOP_PROBE_REPORT: join(root, 'probe.json'), AXIOM_DESKTOP_PROBE_MODE: 'inspect' }, stdio: 'ignore' });
let browser: Browser | undefined;
try {
  for (let i = 0; i < 100; i++) { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { timeout: 500 }); break; } catch { assert.equal(native.exitCode, null); await delay(200); } }
  assert.ok(browser); const context = browser.contexts()[0]; context.setDefaultTimeout(15000);
  let page = context.pages().find(page => page.url().includes('tauri.localhost'));
  for (let i = 0; !page && i < 50; i++) { await delay(100); page = context.pages().find(page => page.url().includes('tauri.localhost')); }
  assert.ok(page);
  await page.getByRole('combobox', { name: '连接设备', exact: true }).waitFor();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  // Exercise cold launch without clicking while environment/status polling continues.
  await delay(30000);
  assert.equal(await page.locator('.connect-page').isVisible(), true);
  assert.deepEqual(errors, []);
  await mkdir(resolve('../artifacts/startup-polish/native'), { recursive: true });
  await page.screenshot({ path: resolve('../artifacts/startup-polish/native/cold-start.png'), fullPage: true });
  await page.getByRole('combobox', { name: '连接设备', exact: true }).click();
  await page.screenshot({ path: resolve('../artifacts/startup-polish/native/device-menu.png'), fullPage: true });
  await page.getByRole('combobox', { name: '连接设备', exact: true }).press('Escape');
  const invoke = <T = any>(name: string, args: Record<string, unknown> = {}) => page!.evaluate(({ name, args }) => (window as any).__TAURI_INTERNALS__.invoke(name, args), { name, args }) as Promise<T>;
  assert.equal(context.pages().filter(candidate => !candidate.url().includes('tauri.localhost') && candidate.url() !== 'about:blank').length, 0, 'idle launch does not connect automatically');
  const environment = await invoke('axiom_setup', { action: 'check' }); assert.equal(environment.nodeReady, true); assert.equal(environment.writable, true); assert.equal(environment.tailscale, true);
  const peers = await invoke('axiom_peers'); assert.ok(Array.isArray(peers.peers)); assert.ok(peers.peers.every((p: any) => p.name && p.ip));
  // Direct local connections ignore missing/damaged installation metadata.
  await page.getByLabel('本地端口').fill(String(targetPort));
  await page.getByRole('button', { name: '连接工作台', exact: true }).click();
  await page.locator('.desktop-workbench-status[data-state=connected]').waitFor({ timeout: 30000 });
  const localView = context.pages().find(candidate => candidate.url().startsWith(app.origin));
  assert.ok(localView, 'explicit local connection opens existing dev service with no installation');
  const localDenied = await localView.evaluate(async () => {
    try { await (window as any).__TAURI_INTERNALS__.invoke('axiom_local', { port: 4317 }); return false; } catch { return true; }
  });
  assert.equal(localDenied, true);
  await invoke('axiom_controls');
  await writeFile(join(data, 'installation.json'), '{broken');
  assert.equal((await invoke('axiom_local', { port: targetPort })).url, app.origin.endsWith('/') ? app.origin : `${app.origin}/`);
  assert.equal(context.pages().find(candidate => candidate.url().startsWith(app.origin)), localView);
  // A different managed service reporting stopped must not discard the direct view.
  const controlFixture = join(root, 'managed-cli.mjs');
  await writeFile(controlFixture, `console.log(JSON.stringify({state:'stopped',active:[]}));`);
  await writeFile(join(data, 'installation.json'), JSON.stringify({ node: process.execPath, cli: controlFixture }));
  await invoke('axiom_service', { action: 'status' });
  await invoke('axiom_service', { action: 'stop' });
  assert.equal(localView.isClosed(), false);
  await page.locator('.desktop-workbench-bar:not([hidden])').waitFor();
  // An old managed view must not let a poll cancel a newer connection in flight.
  await writeFile(controlFixture, `console.log(JSON.stringify({state:'running',active:[],url:${JSON.stringify(app.origin)}}));`);
  await invoke('axiom_service', { action: 'open' });
  await localView.evaluate(() => {
    window.addEventListener('axiom-connection-request', event => {
      event.stopImmediatePropagation();
      void (window as any).__TAURI_INTERNALS__.invoke('axiom_connection_report', { probe: (event as CustomEvent).detail, state: 'disconnected' }).catch(() => {});
    }, true);
  });
  await invoke('axiom_controls');
  const openingLocal = invoke('axiom_local', { port: localProbePort });
  for (let i = 0; !releaseLocalStatus && i < 50; i++) await delay(100);
  assert.ok(releaseLocalStatus, 'new direct request reached its delayed status probe');
  await writeFile(controlFixture, `console.log(JSON.stringify({state:'stopped',active:[]}));`);
  await invoke('axiom_service', { action: 'status' });
  await invoke('axiom_service', { action: 'stop' });
  assert.equal(localView.isClosed(), false, 'management must not discard while a new direct connection is pending');
  releaseLocalStatus();
  assert.equal((await openingLocal).url, `http://127.0.0.1:${localProbePort}/`);
  for (const invalidMode of ['invalid', 'redirect', 'oversize'] as const) {
    localMode = invalidMode;
    await assert.rejects(invoke('axiom_local', { port: localProbePort }));
  }
  await invoke('axiom_controls');
  await rm(join(data, 'installation.json'));
  await assert.rejects(invoke('axiom_local', { port: 0 }), /端口/);
  // Model an interrupted worker using only this test's data directory.
  await mkdir(join(data, 'setup', '123-456'), { recursive: true });
  await writeFile(join(data, 'setup', 'job.json'), JSON.stringify({ id: '123-456', action: 'node', running: true }));
  const interrupted = (await invoke('axiom_setup', { action: 'status' })).job;
  assert.equal(interrupted.phase, 'interrupted'); assert.deepEqual(interrupted.lines, []);
  await assert.rejects(invoke('axiom_setup', { action: 'acknowledge-interruption' }), /确认/);
  assert.equal((await invoke('axiom_setup', { action: 'acknowledge-interruption', confirmed: true })).job.phase, 'error');
  await assert.rejects(invoke('axiom_remote', { address: '127.0.0.1', port: targetPort }));
  const target = `http://${ip}:${targetPort}/`;
  const opened = await invoke('axiom_remote', { address: `http://${ip}:9000`, port: targetPort }); assert.equal(opened.url, target);
  let workbench = context.pages().find(page => page.url().startsWith(target));
  for (let i = 0; !workbench && i < 100; i++) { await delay(100); workbench = context.pages().find(page => page.url().startsWith(target)); }
  assert.ok(workbench, 'Native remote view opened through the real Tailnet interface');
  await workbench.locator('.app').waitFor();
  await page.locator('.desktop-workbench-status[data-state=connected]').waitFor({ timeout: 30000 });
  const denied = await workbench.evaluate(async () => {
    const commands = [['axiom_setup', { action: 'check' }], ['axiom_peers', {}], ['axiom_remote', { address: '100.64.0.1', port: 4317 }], ['axiom_local', { port: 4317 }]];
    return await Promise.all(commands.map(async ([name, args]) => { try { await (window as any).__TAURI_INTERNALS__.invoke(name, args); return false; } catch { return true; } }));
  });
  assert.deepEqual(denied, [true, true, true, true]);
  await invoke('axiom_service', { action: 'status' }); assert.ok(context.pages().includes(workbench));
  await page.screenshot({ path: resolve('../artifacts/startup-polish/native/remote-header.png') });
  // Crash only this isolated client's workbench renderer; never a daily process.
  const cdp = await context.newCDPSession(workbench);
  void cdp.send('Page.crash').catch(() => {});
  await page.locator('.connect-page:not([hidden])').waitFor({ timeout: 30000 });
  await page.getByRole('alert').filter({ hasText: '渲染进程异常' }).waitFor();
  assert.match(await readFile(join(data, 'logs', 'desktop-events.log'), 'utf8'), /ProcessFailed/);
  await page.screenshot({ path: resolve('../artifacts/startup-polish/native/renderer-recovery.png'), fullPage: true });
  assert.deepEqual(errors, []);
  await invoke('axiom_remote', { address: ip, port: targetPort });
  await page.locator('.desktop-workbench-status[data-state=connected]').waitFor({ timeout: 30000 });
  await invoke('axiom_controls');
  await invoke('axiom_remote', { address: ip, port: legacyPort });
  await page.locator('.desktop-workbench-bar:not([hidden])').waitFor();
  const legacyView = context.pages().find(page => page.url().startsWith(`http://${ip}:${legacyPort}/`));
  assert.ok(legacyView); await legacyView.getByRole('heading', { name: 'Legacy backend fixture' }).waitFor();
  await page.locator('.desktop-workbench-status[data-state=checking]').waitFor();
  await invoke('axiom_controls');
  const controlCdp = await context.newCDPSession(page);
  void controlCdp.send('Page.crash').catch(() => {});
  // A fresh CDP attachment avoids retaining Playwright's crashed-page marker.
  await delay(1500);
  const recoveredBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  try {
    const recoveredPage = recoveredBrowser.contexts()[0].pages().find(candidate => candidate.url().includes('tauri.localhost'));
    assert.ok(recoveredPage);
    await recoveredPage.getByRole('combobox', { name: '连接设备', exact: true }).waitFor({ timeout: 15000 });
    assert.equal(await recoveredPage.locator('.connect-page').isVisible(), true);
    assert.equal(native.exitCode, null);
    assert.match(await readFile(join(data, 'logs', 'desktop-events.log'), 'utf8'), /ProcessFailed view=pake/);
    await recoveredPage.screenshot({ path: resolve('../artifacts/startup-polish/native/control-recovery.png'), fullPage: true });
  } finally { await recoveredBrowser.close(); }
  console.log(`PASS: cold launch idle 30s, real environment check, ${peers.peers.length} online peers, partial/interrupted-task confirmation, Tailnet connection and custom port, business socket ready, remote management denied, isolated workbench crash recovery/reconnect and controller crash reload, native diagnostics, legacy backend renders with unknown connection state.`);
} finally {
  await browser?.close().catch(() => {}); native.kill();
  for (let i = 0; native.exitCode === null && i < 50; i++) await delay(100);
  releaseLocalStatus?.();
  localProbe.closeAllConnections();
  await new Promise<void>(resolve => localProbe.close(() => resolve()));
  await new Promise<void>(resolve => legacy.close(() => resolve()));
  await app.close();
  if (native.exitCode !== null) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
