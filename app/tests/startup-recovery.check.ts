import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const output = resolve(process.env.AXIOM_CONNECT_OUTPUT || '../artifacts/connect-implementation/recovery'); await mkdir(output, { recursive: true });
const server = await createServer({ configFile: resolve('desktop/vite.config.ts'), server: { host: '127.0.0.1', port: 0 } }); await server.listen();
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  await page.addInitScript({ content: 'window.__name = value => value;' });
  await page.addInitScript(() => {
    const state = { job: null as any, node: true, broken: false, delayed: false, release: false };
    (window as any).fixture = state;
    (window as any).__TAURI_INTERNALS__ = { invoke: async (name: string, args: any = {}) => {
      if (name === 'axiom_peers') return { peers: null };
      if (name === 'axiom_service') return { state: 'stopped', active: undefined, message: state.broken ? { unexpected: true } : undefined };
      if (name === 'axiom_update') return { clientVersion: '0.4.1', serviceVersion: '0.4.1', clientSupported: true, release: { version: '0.4.2' }, job: null };
      if (name === 'axiom_setup') {
        if (args.action === 'check') return { nodeReady: state.node, writable: true, tailscale: true };
        if (args.action === 'status') {
          const snapshot = state.job;
          if (state.delayed) { state.delayed = false; await new Promise(resolve => setTimeout(resolve, 3000)); }
          return { job: snapshot };
        }
        if (args.action === 'node') { state.job = { id: 'fixture-new', running: true, phase: 'running', message: '安装仍在进行', lines: [] }; return { job: state.job }; }
      }
      return {};
    } };
  });
  await page.goto(server.resolvedUrls!.local[0]);
  await page.locator('.connection-status-tag').filter({ hasText: '已停止' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '启动后台服务', exact: true }).isVisible(), true);
  await page.locator('.startup-preparation > summary').click();
  await page.getByRole('combobox', { name: '连接设备', exact: true }).click();
  await page.getByText('设备列表暂时不可用，请重新读取。 本地连接和手动输入仍可使用。').waitFor();
  assert.equal(await page.getByRole('option', { name: /本地电脑/ }).count(), 1);
  assert.equal(await page.getByRole('option', { name: /手动输入地址/ }).count(), 1);
  await page.getByRole('combobox', { name: '连接设备', exact: true }).press('Escape');
  await page.locator('.startup-maintenance > summary').filter({ hasText: '版本与更新 · Pi 引擎' }).click();
  await page.getByRole('heading', { name: '版本与更新' }).waitFor();
  assert.equal(await page.locator('.startup-fallback').count(), 0);
  // Older status response captured before an installation must not release the new job.
  await page.evaluate(() => { Object.assign((window as any).fixture, { node: false, delayed: true }); });
  await page.getByRole('button', { name: '运行环境 Node.js · npm' }).click();
  await page.getByRole('button', { name: '重新验证环境', exact: true }).click();
  await page.waitForTimeout(1700);
  await page.getByRole('button', { name: '安装 Node.js', exact: true }).click();
  await page.getByText('安装仍在进行', { exact: true }).waitFor();
  await page.waitForTimeout(3500);
  assert.equal(await page.getByRole('combobox', { name: '连接设备', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: '安装 Node.js', exact: true }).isDisabled(), true);
  // Force a render exception outside the normalized status fields and verify recovery.
  await page.evaluate(() => { Object.assign((window as any).fixture, { job: null, broken: true, node: true }); });
  await page.getByRole('heading', { name: '连接页面未能正常显示' }).waitFor();
  await page.screenshot({ path: resolve(output, 'render-fallback.png'), fullPage: true });
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await page.locator('.connection-status-tag').filter({ hasText: '已停止' }).waitFor();
  // Even a failed module fetch leaves a visible static loading/reload surface.
  await page.route('**/main.tsx', route => route.abort());
  await page.reload();
  await page.getByRole('heading', { name: '正在准备连接页面…' }).waitFor();
  assert.equal(await page.getByRole('link', { name: '重新加载' }).isVisible(), true);
  await page.screenshot({ path: resolve(output, 'script-fallback.png'), fullPage: true });
  console.log('PASS: missing active/assets/peer fields, usable menu after discovery failure, late idle snapshot cannot release installation, render error fallback/reload, script-load failure fallback. Controlled IPC; no installers.');
} finally { await browser.close(); await server.close(); }
