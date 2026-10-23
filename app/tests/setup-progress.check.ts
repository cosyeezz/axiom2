// Real React control page with simulated IPC; no downloads or host installation.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const output = resolve(process.env.AXIOM_SETUP_OUTPUT || '/private/tmp/axiom-setup-ui');
await mkdir(output, { recursive: true });
const server = await createServer({ configFile: resolve('desktop/vite.config.ts'), server: { host: '127.0.0.1', port: 0 } }); await server.listen();
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript({ content: 'window.__name = value => value;' });
  await page.addInitScript(() => {
    const now = Date.now();
    const fixture = { job: { id: '123-456', action: 'service', running: true, phase: 'running', message: '正在下载并校验服务安装包…', startedAt: now - 4000, logUpdatedAt: now,
      progress: { name: 'axiom2.tgz', downloaded: 524288, total: 1048576, speed: 262144, startedAt: now - 4000, updatedAt: now, lastByteAt: now }, lines: ['读取正式发布版本 v0.4.99', '正在下载并校验服务安装包…'] } as any };
    (window as any).setupFixture = fixture;
    let theme = 'dark', revision = 0;
    (window as any).__TAURI_INTERNALS__ = { invoke: async (name: string, args: any = {}) => {
      if (name === 'axiom_theme') { if (args.theme) { theme = args.theme; revision++; } return { theme, revision }; }
      if (name === 'axiom_setup') return args.action === 'check' ? { nodeReady: true, nodeVersion: 'v22.23.2', tailscale: true, writable: true, platform: 'windows' } : { job: fixture.job };
      if (name === 'axiom_service') return { state: 'missing', active: [] };
      if (name === 'axiom_update') return { clientVersion: '0.4.99', serviceVersion: null, managed: false, clientSupported: true, release: null, job: null, pi: { runtimeVersion: null, cli: { version: null }, release: null } };
      if (name === 'axiom_peers') return { peers: [] };
      throw Error('Unexpected IPC ' + name);
    } };
  });
  await page.goto(server.resolvedUrls!.local[0]);
  const progress = page.getByLabel('文件下载进度', { exact: true });
  await progress.waitFor();
  assert.match(await progress.innerText(), /512.0 KiB \/ 1.0 MiB · 50.0%/);
  assert.equal(await progress.getByRole('progressbar').getAttribute('value'), '524288');
  assert.match(await progress.innerText(), /256.0 KiB\/s/);
  assert.ok(await page.getByRole('button', { name: '安装并启动服务', exact: true }).isDisabled());
  for (const width of [1100, 600, 390, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `download layout fits ${width}`);
    await page.screenshot({ path: resolve(output, `download-${width}.png`), fullPage: true });
  }
  await page.evaluate(() => { const p = (window as any).setupFixture.job.progress; p.lastByteAt = Date.now() - 12000; p.updatedAt = Date.now(); p.speed = 0; });
  await page.getByRole('button', { name: '重新读取安装进度', exact: true }).click();
  await progress.getByText(/未收到新数据/).waitFor();
  assert.match(await progress.innerText(), /0 B\/s/);
  await page.evaluate(() => { const j = (window as any).setupFixture.job; j.progress = null; j.message = '正在安装后台及运行依赖（npm 不提供总下载进度）'; j.lines.push('npm http fetch GET 200 https://registry.npmjs.org/pi 200ms'); });
  await page.getByRole('button', { name: '重新读取安装进度', exact: true }).click();
  await page.locator('.setup-job pre').getByText(/npm http fetch/).waitFor();
  assert.equal(await progress.count(), 0);
  assert.match(await page.locator('.setup-job').innerText(), /此阶段无可计算的总进度/);
  const message = `安装包 SHA-256 不符：预期 ${'a'.repeat(64)}，实际 ${'b'.repeat(64)}。已拒绝安装，请重新下载。`;
  await page.evaluate(message => { const j = (window as any).setupFixture.job; Object.assign(j, { running: false, phase: 'error', message, exitCode: 1, lines: ['正在校验安装包…', message] }); }, message);
  await page.getByRole('button', { name: '重新读取安装进度', exact: true }).click();
  await page.locator('.setup-job.has-error').waitFor();
  assert.equal(await page.locator('.setup-job > div:first-child > span').textContent(), message);
  assert.equal(await page.locator('.setup-job details').getAttribute('open'), '');
  assert.match(await page.locator('.setup-job summary').innerText(), /退出码 1/);
  assert.doesNotMatch(await page.locator('.setup-job').innerText(), /请查看执行详情/);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'long checksum error fits narrow screen');
  await page.screenshot({ path: resolve(output, 'checksum-error-360.png'), fullPage: true });
  assert.equal(await page.locator('.startup-global-error').count(), 0, 'no caught IPC errors hidden from pageerror checks');
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ passed: true, errors, scope: 'actual React page; fixture IPC only' }, null, 2));
  console.log('PASS: download bytes/size/speed, no-data wait, npm logs, exact error and four viewport sizes.');
} finally { await browser.close(); await server.close(); }
