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
    invoke: async (action: string, detail: { stage: string; expectedState: string }) => {
      assert.equal(action, 'progress');
      assert.ok(['service-heading-port', 'service-heading-state'].includes(detail.stage));
      assert.ok(['running', 'stopped'].includes(detail.expectedState));
    },
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

test('controller retention samples the settled fixture before switching and preserves failure evidence', () => {
  const checkpointAck = source.indexOf('await wait(async () => (await invoke("snapshot")).acknowledged)');
  const settledBaseline = source.indexOf('retention.before = before');
  const leave = source.indexOf('(await button("服务与更新")).click()', checkpointAck);
  assert.ok(checkpointAck >= 0 && checkpointAck < settledBaseline && settledBaseline < leave);
  assert.ok(source.includes('before.scroll === 237') && source.includes('before.focused'));
  for (const field of ['initial', 'before', 'after', 'dock', 'directRestarted']) {
    assert.ok(source.includes(`retention.${field} =`), `Missing retained ${field} sample`);
  }
  assert.match(source, /invoke\("failed", \{[^\n]*retention/);
  assert.match(source, /invoke\("finished", \{[^\n]*retention/);
});

test('controller port changes await committed React UI without requiring animation frames', async () => {
  for (const port of [4317, 55702]) {
    let committedCustom = port === 4317;
    let pendingCustom = committedCustom;
    let waitedForCommit = 0;
    const stages: string[] = [];
    const input = { value: port === 4317 ? '55702' : '4317', dispatchEvent: () => { pendingCustom = input.value !== '4317'; } };
    const prototype = Object.defineProperty({}, 'value', { set(value: string) { input.value = value; } });
    const context: any = {
      HTMLInputElement: { prototype }, Event: class {},
      invoke: async (action: string, detail: any) => { assert.equal(action, 'progress'); assert.equal(detail.port, port); stages.push(detail.stage); },
      document: { querySelector: (selector: string) => {
        if (selector === 'input[aria-label="本地端口"]:not(:disabled)') return input;
        assert.equal(selector, '.connection-primary-meta [role="status"]');
        return { textContent: committedCustom ? '连接此端口上已有的服务' : '服务已启动，可以连接工作台' };
      } },
      wait: async (condition: () => any) => {
        const initial = await condition(); if (initial) return initial;
        waitedForCommit++; committedCustom = pendingCustom;
        const committed = await condition(); assert.ok(committed, 'Expected actual React UI commitment'); return committed;
      },
    };
    const portSource = source.slice(source.indexOf('  const setPort = '), source.indexOf('  const connectFixture = '));
    runInNewContext(`${portSource}\nObject.assign(globalThis, { setPort });`, context);
    await context.setPort(port);
    assert.equal(input.value, String(port));
    assert.equal(waitedForCommit, 1, 'A raw input value alone cannot acknowledge the React state');
    assert.deepEqual(stages, ['port-input-found', 'port-ui-committed']);
  }
});

test('controller fresh samples reject stale correlation IDs and non-increasing samples', async () => {
  const valid = { sampleId: 'fresh-id', sample: 2 };
  const observations = [{ sampleId: 'stale-id', sample: 5 }, { sampleId: 'fresh-id', sample: 1 }, valid];
  const requests: any[] = [];
  const context: any = {
    crypto: { randomUUID: () => 'fresh-id' },
    invoke: async (action: string, request: any) => {
      if (action === 'sample') { requests.push(request); return; }
      assert.equal(action, 'snapshot');
      assert.ok(observations.length, 'No fresh matching sample arrived');
      return { observation: observations.shift() };
    },
    wait: async (condition: () => any) => {
      for (let attempt = 0; attempt < 3; attempt++) { const value = await condition(); if (value) return value; }
      throw Error('No matching sample');
    },
  };
  const sampling = source.slice(source.indexOf('  const observation = '), source.indexOf('  const bounds = '));
  runInNewContext(`${sampling}\nObject.assign(globalThis, { freshSample });`, context);
  assert.equal(await context.freshSample((value: any) => value.sample > 1), valid);
  assert.equal(observations.length, 0, 'Both the stale ID and non-increasing sample were rejected');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].sampleId, 'fresh-id');
});

test('controller failure inspection cannot erase captured retention samples', async () => {
  const before = { token: 'retained-view', scroll: 237 };
  const after = { token: 'retained-view', scroll: 2399 };
  let observation: any = after;
  const actions: string[] = [];
  let failed: any;
  const context: any = {
    retention: { before, after }, stage: 'workbench-lifecycle', controllerLayouts: [], lastControlLayout: null,
    viewport: () => ({ width: 900, height: 48 }), console: { error: () => {} },
    setTimeout: (done: () => void) => { done(); return 0; },
    invoke: async (action: string, detail: any) => {
      actions.push(action);
      if (action === 'inspect-workbench') observation = { inspected: true };
      else { assert.equal(action, 'failed'); failed = detail; }
    },
  };
  const marker = '  })().catch(async (error) => {';
  const start = source.indexOf(marker);
  assert.ok(start >= 0);
  const handler = source.slice(start + marker.length, source.lastIndexOf('  });'));
  runInNewContext(`globalThis.captureFailure = async (error) => {${handler}};`, context);
  await context.captureFailure(Error('Switching lost state'));
  assert.deepEqual(actions, ['inspect-workbench', 'failed']);
  assert.deepEqual(observation, { inspected: true });
  assert.equal(failed.retention.before, before);
  assert.equal(failed.retention.after, after);
  assert.match(failed.error, /Switching lost state/);
});

test('controller probe retains both lifecycle contracts and confirmation without stale service button selectors', () => {
  assert.equal((source.match(/serviceButton\("stopped", "启动"\)/g) || []).length, 3);
  assert.equal((source.match(/serviceButton\("running", "关闭"\)/g) || []).length, 2);
  assert.equal((source.match(/button\("确认关闭服务"\)/g) || []).length, 2);
  assert.ok(source.includes('direct-restart-preserves-view') && source.includes('managed-stop-discards-view'));
  assert.ok(!source.includes('button("启动服务")') && !source.includes('button("关闭后台服务")'));
  assert.ok(source.includes('Date.now() + 60000'), 'The native wait budget is unchanged');
});
