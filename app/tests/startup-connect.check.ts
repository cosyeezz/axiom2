import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const output = resolve(process.env.AXIOM_CONNECT_OUTPUT || '../artifacts/connect-implementation/browser'); await mkdir(output, { recursive: true });
const server = await createServer({ configFile: resolve('desktop/vite.config.ts'), server: { host: '127.0.0.1', port: 0 } }); await server.listen();
const origin = server.resolvedUrls!.local[0];
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = []; page.on('pageerror', error => { errors.push(error.message); console.error('pageerror:', error.message); });
  // tsx preserves names of nested fixture callbacks using this emitted helper.
  await page.addInitScript({ content: 'window.__name = value => value;' });
  await page.addInitScript(() => {
    function assertFixture(confirmed: boolean) { if (!confirmed) throw Error('缺少解除确认'); }
    const state = { node: false, installed: false, view: 'control', connection: 'connected', job: null as any, calls: [] as any[], remoteFail: false, remoteDelay: false, stopped: false, starting: false, statusFail: false };
    (window as any).fixture = state;
    (window as any).__TAURI_INTERNALS__ = { invoke: async (name: string, args: any = {}) => {
      state.calls.push({ name, args });
      if (name === 'axiom_setup') {
        if (args.action === 'check') return { nodeReady: state.node, nodeVersion: state.node ? 'v24.13.0' : '', writable: true, tailscale: true, platform: 'windows' };
        if (args.action === 'status') return { job: state.job };
        if (args.action === 'acknowledge-interruption') { assertFixture(args.confirmed); state.job = { ...state.job, running: false, phase: 'error', message: '已解除占用' }; return { job: state.job }; }
        if (['node','service'].includes(args.action)) {
          state.job = { action: args.action, running: true, phase: 'running', message: '正在执行测试安装步骤…', lines: ['开始处理'] };
          setTimeout(() => { state.node = true; if (args.action === 'service') state.installed = true; state.job = { ...state.job, running: false, phase: 'done', message: '步骤完成' }; }, 600);
          return { job: state.job };
        }
        return {};
      }
      if (name === 'axiom_service') {
        if (state.statusFail && args.action === 'status') throw Error('服务状态读取失败');
        if (args.action === 'open') state.view = 'workbench';
        if (args.action === 'stop') { state.stopped = true; state.view = 'control'; }
        if (args.action === 'start') state.stopped = false;
        return { desktopView: state.view, state: state.installed ? state.starting ? 'starting' : state.stopped ? 'stopped' : 'running' : 'missing', active: ['设计会话', '代码检查'], url: 'http://127.0.0.1:4317/' };
      }
      if (name === 'axiom_peers') return { peers: [{ name: 'Studio', ip: '100.64.0.8' }, { name: 'Laptop', ip: '100.70.1.2' }] };
      if (name === 'axiom_remote' || name === 'axiom_local') { if (name === 'axiom_local') args = { ...args, address: '127.0.0.1' }; if (state.remoteDelay) await new Promise(resolve => setTimeout(resolve, 600)); if (state.remoteFail) throw Error('目标服务尚未启动'); state.view = 'workbench'; return { url: (() => { const url = new URL(args.address.includes('://') ? args.address : `http://${args.address}`); url.port = String(args.port); return url.href; })() }; }
      if (name === 'axiom_connection') return state.connection;
      if (name === 'axiom_controls') { state.view = 'control'; return; }
      if (name === 'axiom_update') return { clientVersion: '0.4.1', serviceVersion: '0.4.1', managed: true, clientSupported: true, release: null, job: null };
      throw Error(`Unexpected ${name}`);
    } };
  });
  await page.goto(origin);
  await page.getByRole('button', { name: '连接工作台', exact: true }).waitFor();
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => (window as any).fixture.calls.filter((call: any) => ['axiom_local', 'axiom_remote'].includes(call.name) || call.args.action === 'open').length), 0, 'never auto-connect');
  for (const [width, height] of [[1440, 900], [1100, 768], [1024, 768], [820, 1180], [844, 390], [600, 960], [430, 900], [390, 844], [360, 800]]) {
    await page.setViewportSize({ width, height });
    const geometry = await page.evaluate(() => { const first = document.querySelector('.connect-header')!.getBoundingClientRect(), last = document.querySelector('.connect-footer')!.getBoundingClientRect(); return { height: document.documentElement.scrollHeight, width: document.documentElement.scrollWidth, center: (first.top + last.bottom) / 2 }; });
    assert.ok(geometry.height <= height + 1 && geometry.width <= width + 1, `no unnecessary scrolling ${width}x${height}`);
    assert.ok(Math.abs(geometry.center - height / 2) <= 4, `content centered ${width}x${height}`);
    assert.equal(await page.locator('.startup-title h1').textContent(), '就绪之后，专注创造。');
    const controls = await page.evaluate(() => { const port = document.querySelector('.connection-port input')!.getBoundingClientRect(), connect = document.querySelector('.startup-connect-button')!.getBoundingClientRect(), device = document.querySelector('.device-trigger')!.getBoundingClientRect(); return { gap: connect.left - port.right, height: connect.height, portCenter: port.top + port.height / 2, connectCenter: connect.top + connect.height / 2, deviceCenter: device.top + device.height / 2 }; });
    assert.equal(controls.height, 44);
    assert.ok(Math.abs(controls.gap - 12) <= 1, 'port and connect are adjacent with 12px gap');
    assert.ok(Math.abs(controls.portCenter - controls.connectCenter) <= 1, 'port/button center alignment');
    if (width > 580) assert.ok(Math.abs(controls.deviceCenter - controls.connectCenter) <= 1, 'desktop field alignment');
    assert.equal(await page.locator('.connection-service').isVisible(), true, 'service controls remain visible with preparation collapsed');
    assert.equal(await page.getByLabel('Node.js：未就绪', { exact: true }).isVisible(), true);
    assert.equal(await page.getByLabel('Tailscale：已检测到', { exact: true }).isVisible(), true);
    await page.screenshot({ path: resolve(output, `direct-${width}x${height}.png`), fullPage: true });
    await page.getByRole('combobox', { name: '连接设备', exact: true }).click();
    const menu = await page.locator('.device-menu').boundingBox();
    assert.ok(menu && menu.y >= 0 && menu.y + menu.height <= height, 'menu stays within viewport');
    await page.getByRole('button', { name: '刷新设备', exact: true }).focus();
    assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), `menu stays inside viewport ${width}x${height}`);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('combobox', { name: '连接设备', exact: true }).getAttribute('aria-expanded'), 'false');
    assert.equal(await page.getByRole('combobox', { name: '连接设备', exact: true }).evaluate(node => document.activeElement === node), true);
  }
  await page.setViewportSize({ width: 1100, height: 768 });
  await page.screenshot({ path: resolve(output, 'direct-connect.png'), fullPage: true });
  await page.getByLabel('本地端口').fill('8123');
  await page.getByRole('button', { name: '连接工作台', exact: true }).click();
  await page.locator('.desktop-workbench-status[data-state=connected]').waitFor();
  assert.equal(await page.evaluate(() => (window as any).fixture.calls.filter((call: any) => call.name === 'axiom_local').at(-1).args.port), 8123);
  assert.equal(await page.evaluate(() => (window as any).fixture.installed), false, 'local development service needs no installation');
  await page.getByRole('button', { name: '服务与更新', exact: false }).click();
  await page.locator('.startup-preparation > summary').click();
  await page.getByRole('button', { name: '安装 Node.js', exact: true }).waitFor();
  await page.getByRole('button', { name: '后台服务 安装与校验' }).click();
  assert.ok(await page.getByRole('button', { name: '安装并启动服务', exact: true }).isDisabled());
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: '复制一行安装命令', exact: true }).click();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /install\.ps1 \| iex/);
  await page.locator('.startup-manual > summary').click();
  await page.getByRole('button', { name: '复制手动安装命令', exact: true }).click();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /npm install --global https:\/\/github.com\/cosyeezz\/axiom2\/releases\/latest\/download\/axiom2.tgz/);
  await page.screenshot({ path: resolve(output, 'install-methods.png'), fullPage: true });
  await page.getByRole('button', { name: '运行环境 Node.js · npm' }).click();
  await page.getByRole('button', { name: '打开Node.js 下载地址', exact: true }).click();
  await page.waitForFunction(() => !(document.querySelector('[role=combobox]') as HTMLButtonElement)?.disabled, undefined, { timeout: 2000 });
  assert.equal(await page.getByRole('combobox', { name: '连接设备', exact: true }).isEnabled(), true, 'instant link actions must release busy state');
  await page.screenshot({ path: resolve(output, 'local-first-install.png'), fullPage: true });
  await page.getByRole('button', { name: '安装 Node.js', exact: true }).click();
  await page.locator('.setup-job .startup-spin').waitFor();
  assert.ok(await page.getByRole('combobox', { name: '连接设备', exact: true }).isDisabled());
  await page.getByRole('button', { name: '安装并启动服务', exact: true }).waitFor();
  await page.getByRole('button', { name: '安装并启动服务', exact: true }).click();
  await page.getByRole('button', { name: '打开工作台', exact: false }).waitFor();
  await page.waitForFunction(() => !(document.querySelector('.setup-job .startup-spin')));
  await page.locator('.startup-preparation > summary').click();
  await page.getByLabel('本地端口').fill('4317');
  for (const [width, height] of [[1440, 900], [820, 1180], [844, 390], [600, 960], [390, 844], [360, 800]]) {
    await page.setViewportSize({ width, height });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight + 1), `running layout fits ${width}x${height}`);
    assert.equal(await page.getByRole('button', { name: '关闭后台服务', exact: true }).isVisible(), true);
    assert.equal(await page.locator('.startup-maintenance > summary').isVisible(), true);
    assert.equal(await page.locator('.startup-connect-button svg').evaluate(node => node.getBoundingClientRect().width), 21);
    await page.locator('.connect-header').click();
    await page.screenshot({ path: resolve(output, `ready-${width}x${height}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('combobox', { name: '连接设备', exact: true }).click();
  await page.screenshot({ path: resolve(output, 'ready-portrait-menu.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await page.evaluate(() => { (window as any).fixture.starting = true; });
  await page.getByRole('button', { name: '刷新服务状态', exact: true }).click();
  await page.locator('.connection-status-tag').filter({ hasText: '启动中' }).waitFor();
  await page.getByRole('button', { name: '关闭后台服务', exact: true }).click();
  await page.getByRole('dialog', { name: '关闭后台服务？' }).waitFor();
  assert.ok((await page.getByRole('dialog').innerText()).includes('当前有 2 个会话'));
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button', { name: '关闭后台服务', exact: true }).evaluate(node => node === document.activeElement), true);
  await page.evaluate(() => { Object.assign((window as any).fixture, { starting: false, statusFail: true }); });
  await page.getByRole('button', { name: '刷新服务状态', exact: true }).click();
  await page.locator('.connection-status-tag[data-state=unknown]').waitFor();
  assert.equal(await page.getByRole('button', { name: '关闭后台服务', exact: true }).isDisabled(), true);
  await page.evaluate(() => { (window as any).fixture.statusFail = false; });
  await page.getByRole('button', { name: '刷新服务状态', exact: true }).click();
  await page.locator('.connection-status-tag[data-state=running]').waitFor();
  await page.locator('.startup-preparation > summary').click();
  for (const width of [1440, 820, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `local fits ${width}`);
    await page.screenshot({ path: resolve(output, `local-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1100, height: 850 });
  // A confirmed stop must wait for an overlapping quiet status read, not vanish.
  await page.evaluate(() => {
    const fixture = (window as any).fixture, bridge = (window as any).__TAURI_INTERNALS__, original = bridge.invoke;
    bridge.invoke = async (name: string, args: any) => {
      if (name === 'axiom_service' && args.action === 'status') {
        bridge.invoke = original;
        await new Promise<void>(resolve => { fixture.releaseStatus = resolve; });
      }
      return original(name, args);
    };
  });
  await page.waitForFunction(() => typeof (window as any).fixture.releaseStatus === 'function');
  await page.getByRole('button', { name: '关闭后台服务', exact: true }).click();
  await page.getByRole('button', { name: '确认关闭服务', exact: true }).click();
  assert.equal(await page.evaluate(() => (window as any).fixture.calls.filter((call: any) => call.name === 'axiom_service' && call.args.action === 'stop').length), 0);
  await page.evaluate(() => (window as any).fixture.releaseStatus());
  await page.locator('.connection-status-tag').filter({ hasText: '已停止' }).waitFor();
  await page.getByRole('button', { name: '启动后台服务', exact: true }).click();
  await page.locator('.connection-status-tag').filter({ hasText: '运行中' }).waitFor();
  await page.getByRole('combobox', { name: '连接设备', exact: true }).click();
  await page.screenshot({ path: resolve(output, 'device-menu.png'), fullPage: true });
  assert.equal(await page.getByRole('option').count(), 4);
  await page.getByRole('combobox', { name: '连接设备', exact: true }).press('Escape');
  await page.getByRole('combobox', { name: '连接设备', exact: true }).press('ArrowDown');
  await page.getByRole('combobox', { name: '连接设备', exact: true }).press('ArrowDown');
  await page.getByRole('combobox', { name: '连接设备', exact: true }).press('Enter');
  await page.locator('.device-name small').filter({ hasText: '100.64.0.8' }).waitFor();
  assert.equal(await page.locator('.connection-service').count(), 0, 'remote target has no local stop action');
  await page.evaluate(() => { (window as any).fixture.remoteFail = true; (window as any).fixture.remoteDelay = true; });
  await page.getByRole('button', { name: '连接工作台', exact: true }).click();
  assert.ok(await page.getByRole('combobox', { name: '连接设备', exact: true }).isDisabled());
  assert.ok(await page.getByRole('button', { name: '连接环境 Tailscale' }).isDisabled());
  await page.getByRole('alert').filter({ hasText: '目标服务尚未启动' }).waitFor();
  assert.equal(await page.locator('.device-name small').textContent(), '100.64.0.8');
  await page.screenshot({ path: resolve(output, 'remote-failure.png'), fullPage: true });
  await page.evaluate(() => { (window as any).fixture.remoteFail = false; });
  await page.getByRole('button', { name: '连接工作台', exact: true }).click();
  await page.locator('.desktop-workbench-status[data-state=connected]').waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('axiom.remote.address')), 'http://100.64.0.8:4317/');
  assert.equal(await page.locator('.desktop-update-dot').count(), 0);
  for (const width of [1440, 820, 430, 390, 360]) {
    await page.setViewportSize({ width, height: 48 });
    const layout = await page.evaluate(() => {
      const nodes = ['.desktop-workbench-status', '.desktop-workbench-bar button'].map(selector => document.querySelector(selector)!.getBoundingClientRect());
      return { centers: nodes.map(box => box.y + box.height / 2), right: nodes[1].right, leftEnd: nodes[0].right, buttonStart: nodes[1].left, width: innerWidth };
    });
    assert.ok(Math.max(...layout.centers) - Math.min(...layout.centers) < 1, `center alignment ${width}`);
    assert.ok(layout.right <= layout.width && layout.leftEnd <= layout.buttonStart, `header fits ${width}`);
    await page.locator('.desktop-workbench-bar button').hover();
    assert.equal(await page.locator('.desktop-workbench-bar button').evaluate(node => getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)');
    await page.screenshot({ path: resolve(output, `header-${width}.png`) });
  }
  await page.evaluate(() => { (window as any).fixture.connection = 'disconnected'; });
  await page.locator('.desktop-update-dot').waitFor();
  await page.getByRole('button', { name: '服务与更新', exact: false }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(await page.locator('.desktop-update-dot').count(), 0);
  await page.screenshot({ path: resolve(output, 'remote-ready.png'), fullPage: true });
  // A saved protocol-default port is omitted by URL serialization, but must survive a reload.
  for (const [url, port] of [['http://100.64.0.8/', '80'], ['https://100.64.0.8/', '443'], ['http://100.64.0.8:9000/', '9000']]) {
    await page.evaluate(value => localStorage.setItem('axiom.remote.address', value), url);
    await page.reload();
    await page.getByLabel('远程端口').waitFor();
    assert.equal(await page.getByLabel('远程端口').inputValue(), port);
  }
  await page.getByLabel('远程端口').fill('8123');
  await page.getByRole('button', { name: '连接工作台', exact: true }).click();
  await page.locator('.desktop-workbench-status[data-state=connected]').waitFor();
  assert.equal(await page.evaluate(() => (window as any).fixture.calls.filter((c: any) => c.name === 'axiom_remote').at(-1).args.port), 8123);
  await page.getByRole('button', { name: '服务与更新', exact: false }).click();
  await page.getByRole('combobox', { name: '连接设备', exact: true }).click();
  await page.getByRole('option', { name: /本地电脑/ }).click();
  await page.locator('.startup-preparation > summary').click();
  await page.evaluate(() => { (window as any).fixture.job = { action: 'node', running: false, phase: 'interrupted', message: '上次安装中断', lines: [] }; });
  const recover = page.getByRole('button', { name: '确认安装器退出后解除占用' });
  await recover.waitFor();
  assert.ok(await page.getByRole('button', { name: '安装 Node.js', exact: true }).isDisabled());
  await recover.click();
  const recoveryDialog = page.getByRole('dialog', { name: '确认安装器已退出？' });
  await recoveryDialog.waitFor();
  assert.equal(await recoveryDialog.getByRole('button', { name: '取消', exact: true }).evaluate(node => document.activeElement === node), true);
  await recoveryDialog.getByRole('button', { name: '取消', exact: true }).click();
  await recoveryDialog.waitFor({ state: 'hidden' });
  assert.equal(await recover.evaluate(node => document.activeElement === node), true);
  await recover.click();
  await page.keyboard.press('Escape');
  await recoveryDialog.waitFor({ state: 'hidden' });
  assert.equal(await recover.evaluate(node => document.activeElement === node), true);
  assert.equal(await page.evaluate(() => (window as any).fixture.calls.filter((c: any) => c.args.action === 'acknowledge-interruption').length), 0);
  await recover.click();
  await page.screenshot({ path: resolve(output, 'interrupted-install-confirmation.png'), fullPage: true });
  await recoveryDialog.getByRole('button', { name: '我已确认安装器全部退出', exact: true }).click();
  await recover.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => (window as any).fixture.calls.filter((c: any) => c.args.action === 'acknowledge-interruption').length), 1);
  assert.deepEqual(errors, []);
  // A partial installation record must not unmount the page when no log exists.
  await page.evaluate(() => { (window as any).fixture.job = { running: false, phase: 'error', message: '异常记录测试' }; });
  await page.getByText('异常记录测试', { exact: true }).waitFor();
  assert.equal(await page.locator('.connect-page').isVisible(), true);
  assert.deepEqual(errors, []);
  // An unresponsive local status call must leave remote device selection available.
  await page.evaluate(() => { const bridge = (window as any).__TAURI_INTERNALS__; const original = bridge.invoke; bridge.invoke = (name: string, args: any) => name === 'axiom_service' ? new Promise(() => {}) : original(name, args); });
  await page.getByRole('button', { name: '连接工作台 启动与验证' }).click();
  await page.getByRole('button', { name: '刷新服务状态', exact: true }).click();
  assert.equal(await page.getByRole('combobox', { name: '连接设备', exact: true }).isEnabled(), true);
  await page.getByRole('combobox', { name: '连接设备', exact: true }).click();
  await page.getByRole('option', { name: /手动输入地址/ }).click();
  await page.getByLabel('远程连接地址', { exact: true }).waitFor();
  await page.getByRole('alert').filter({ hasText: '客户端响应超时' }).waitFor({ timeout: 30000 });
  assert.deepEqual(errors, []);
  console.log('PASS: first-install steps, real job polling UI, disabled actions, peer selection/default port, failure retry, successful address persistence/default and custom port recovery/interrupted install acknowledgement, header alignment/transparent hover/change acknowledgement, 360–1440px layouts. IPC is a controlled fixture; no software was installed.');
} finally { await browser.close(); await server.close(); }
