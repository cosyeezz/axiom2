import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../desktop/test-controller-probe.js', import.meta.url), 'utf8');
const controls = source.slice(source.indexOf('  const heading = '), source.indexOf('  const observation = '));
function fixture({ state = 'stopped', uiState = state, label = state === 'running' ? '运行中' : '已停止', visible = true, disabled = false, primary = state === 'running' ? '关闭' : '启动' }: { state?: string; uiState?: string; label?: string; visible?: boolean; disabled?: boolean; primary?: string } = {}) {
  const status = { dataset: { state: uiState }, textContent: label, getClientRects: () => visible ? [{}] : [] };
  const action = { textContent: primary, disabled, getClientRects: () => visible ? [{}] : [] };
  const ports: number[] = [];
  const bridge: string[] = [];
  const context: any = { ports, bridge,
    check: (condition: boolean, message: string) => assert.ok(condition, message),
    wait: async (condition: () => any) => { const value = await condition(); assert.ok(value, 'Condition not met'); return value; },
    setPort: async (port: number) => { ports.push(port); },
    document: { querySelectorAll: (selector: string) => {
      if (selector === '.connection-service-heading .connection-status-tag') return [status];
      if (selector === 'button.connection-primary-button') return [action];
      throw Error(`Unexpected probe selector: ${selector}`);
    } },
    window: { __TAURI_INTERNALS__: { invoke: async (command: string, request: any) => {
      assert.equal(command, 'axiom_service'); assert.equal(request.action, 'status');
      bridge.push(command); return { state };
    } } },
  };
  runInNewContext(`${controls}\nObject.assign(globalThis, {heading, serviceButton});`, context);
  return { ...context, action };
}

test('controller probe binds visible status badge and native service state before the current primary button', async () => {
  for (const state of ['stopped', 'running']) {
    const context = fixture({ state });
    assert.equal(await context.serviceButton(state, state === 'running' ? '关闭' : '启动'), context.action);
    assert.deepEqual(context.ports, [4317]);
    assert.equal(context.bridge.length, 1);
  }
});

test('controller probe rejects stale UI state, wrong label, hidden or disabled service controls', async () => {
  for (const changes of [{ uiState: 'running' }, { label: '运行中' }, { visible: false }, { disabled: true }, { primary: '下载和安装' }]) {
    const context = fixture(changes);
    await assert.rejects(context.serviceButton('stopped', '启动'));
  }
  const context = fixture({ state: 'running', uiState: 'stopped', label: '已停止' });
  await assert.rejects(context.heading('服务已停止'));
});

test('controller probe retains both lifecycle contracts and confirmation without stale service button selectors', () => {
  assert.equal((source.match(/serviceButton\("stopped", "启动"\)/g) || []).length, 3);
  assert.equal((source.match(/serviceButton\("running", "关闭"\)/g) || []).length, 2);
  assert.equal((source.match(/button\("确认关闭服务"\)/g) || []).length, 2);
  assert.ok(source.includes('direct-restart-preserves-view') && source.includes('managed-stop-discards-view'));
  assert.ok(!source.includes('button("启动服务")') && !source.includes('button("关闭后台服务")'));
  assert.ok(source.includes('Date.now() + 60000'), 'The native wait budget is unchanged');
});
