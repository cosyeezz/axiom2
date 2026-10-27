import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs, { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { ExecutionProfiles } from '../src/server/execution-profile.js';
import { rejectExecution, safeExecutionRejection, type ExecutionRejection } from '../src/server/execution-diagnostics.js';
import { resourceIdentity, resourceIdentityAsync } from '../src/server/agents/resource-identity.js';
import { capabilityFileDigest, type CapabilityRuntime } from '../src/server/capability-resources.js';
import { proxyRuntimePath } from '../src/server/integrations/model-proxy-config.js';

const canary = 'PRIVATE_DIAGNOSTIC_CANARY';

test('sanitizer reads each field once and contains malformed or throwing diagnostics', () => {
  for (const input of [null, undefined, 1, canary, () => {}, new Proxy({}, { get() { throw Error(canary); } })]) {
    assert.deepEqual(safeExecutionRejection(input), { check: 'verification' });
  }
  const values = { check: 'resource_scan', stage: 'resource_read', scope: 'app', resource: 'skills', cause: 'length', changed: 0 };
  const reads = new Map<PropertyKey, number>();
  const hostile = new Proxy(values, { get(target, key) {
    const count = (reads.get(key) ?? 0) + 1; reads.set(key, count);
    return count === 1 ? Reflect.get(target, key) : canary;
  } });
  assert.deepEqual(safeExecutionRejection(hostile), values);
  assert.deepEqual([...reads.values()], [1, 1, 1, 1, 1, 1]);
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'axiom-rejection-')), cwd = join(root, canary), pi = join(root, 'pi');
  mkdirSync(join(cwd, '.pi', 'skills'), { recursive: true }); mkdirSync(pi);
  const raw = '{"providers":{}}'; writeFileSync(join(pi, 'models.json'), raw);
  return { root, cwd, pi, profiles: new ExecutionProfiles(root), input: { entry: 'agent' as const, cwd, modelDir: pi, modelsRaw: raw, mode: 'D' as const }, close: () => rmSync(root, { recursive: true, force: true }) };
}

test('rejection diagnostics whitelist enums and never expose arbitrary errors, paths or values', () => {
  const input = { check: canary, stage: canary, scope: canary, resource: canary, cause: 'EACCES', changed: 128, path: `/${canary}`, error: Error(canary), secret: canary } as unknown as ExecutionRejection;
  assert.deepEqual(safeExecutionRejection(input), { check: 'verification' });
  const accepted = safeExecutionRejection({ check: 'resource_scan', stage: 'resource_final', scope: 'project', resource: 'skills', cause: 'metadata', changed: 32 });
  assert.equal(Object.isFrozen(accepted), true);
  assert.equal(JSON.stringify(accepted).includes(canary), false);
  assert.equal(rejectExecution(() => { throw Error(canary); }, { check: 'snapshot' }), false, 'observer failure cannot alter admission');
});

for (const domain of ['models', 'auth', 'models_store', 'settings', 'proxy', 'capability_file', 'resource_digest', 'snapshot'] as const) {
  test(`profile reports the actual first rejecting predicate without exposing content: ${domain}`, async () => {
    const f = fixture(), settings = join(f.pi, 'settings.json');
    writeFileSync(settings, '{}');
    const capabilities: CapabilityRuntime | undefined = domain === 'capability_file' ? { selection: { skills: [], mcp: [] }, skillPaths: [], mcp: {} as CapabilityRuntime['mcp'], warnings: [], files: [{ path: settings, digest: capabilityFileDigest(settings) }] } : undefined;
    const environment = await f.profiles.prepareAsync({ ...f.input, capabilities });
    const rejections: Readonly<ExecutionRejection>[] = [];
    try {
      assert.equal(await environment.currentAsync!(undefined, rejection => rejections.push(rejection)), true);
      if (domain === 'snapshot') writeFileSync(environment.modelsFile, canary);
      else if (domain === 'models') writeFileSync(join(f.pi, 'models.json'), JSON.stringify({ providers: { [canary]: {} } }));
      else if (domain === 'auth') writeFileSync(join(f.pi, 'auth.json'), JSON.stringify({ [canary]: {} }));
      else if (domain === 'models_store') writeFileSync(join(f.pi, 'models-store.json'), JSON.stringify({ [canary]: {} }));
      else if (domain === 'settings') writeFileSync(settings, JSON.stringify({ [canary]: true }));
      else if (domain === 'capability_file') writeFileSync(settings, '{\n}'); // Canonically equal, but the capability byte digest changes.
      else if (domain === 'proxy') { const file = proxyRuntimePath(f.root); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, canary); }
      else writeFileSync(join(f.cwd, '.pi', 'skills', `${canary}.md`), canary);
      const independent = ['models', 'auth', 'models_store', 'proxy'].includes(domain);
      assert.equal(domain === 'snapshot' ? environment.snapshotValid(rejection => rejections.push(rejection)) : await environment.currentAsync!(undefined, rejection => rejections.push(rejection)), independent);
      assert.equal(rejections.length, independent ? 0 : 1);
      if (!independent) assert.equal(rejections[0].check, domain);
      if (domain === 'capability_file') assert.equal(rejections[0].resource, 'settings');
      assert.equal(JSON.stringify(rejections).includes(canary), false);
      assert.equal(JSON.stringify(rejections).includes(f.root), false);
      assert.equal(domain === 'snapshot' ? environment.snapshotValid(() => { throw Error(canary); }) : await environment.currentAsync!(undefined, () => { throw Error(canary); }), independent);
    } finally { environment.release(); f.close(); }
  });
}

test('asynchronous resource diagnostics ignore credential changes but retain cancellation', async () => {
  const f = fixture(), environment = await f.profiles.prepareAsync(f.input), rejections: Readonly<ExecutionRejection>[] = [];
  try {
    const pending = environment.currentAsync!(undefined, rejection => rejections.push(rejection));
    writeFileSync(join(f.pi, 'auth.json'), JSON.stringify({ [canary]: true }));
    assert.equal(await pending, true);
    assert.equal(rejections.length, 0);
    const controller = new AbortController(); controller.abort(Error(canary)); rejections.length = 0;
    assert.equal(await environment.currentAsync!(controller.signal, rejection => rejections.push(rejection)), false);
    assert.deepEqual(rejections, [{ check: 'aborted', stage: 'pre_io' }]);
  } finally { environment.release(); f.close(); }
});

for (const phase of ['before', 'after'] as const) {
  test(`resource diagnostics retain metadata checks and identify handle mismatch ${phase} reading`, async t => {
    const f = fixture(), file = join(f.cwd, '.pi', 'skills', `${canary}.md`);
    writeFileSync(file, canary);
    const inode = fs.statSync(file, { bigint: true }).ino, handle = await fs.promises.open(file, 'r'), prototype = Object.getPrototypeOf(handle), stat = prototype.stat;
    await handle.close(); let seen = 0;
    const patched = t.mock.method(prototype, 'stat', async function(this: any, ...args: any[]) {
      const value = await stat.apply(this, args);
      if (value.ino === inode && ++seen === (phase === 'before' ? 1 : 2)) return Object.assign(Object.create(Object.getPrototypeOf(value)), value, { ctimeNs: value.ctimeNs + 1n });
      return value;
    });
    try {
      let rejection: Readonly<ExecutionRejection> | undefined;
      await assert.rejects(resourceIdentityAsync(f.cwd, f.pi, undefined, value => { rejection = value; }), error => {
        assert.match((error as Error).message, /Resource changed/);
        assert.deepEqual(rejection, { check: 'resource_scan', stage: phase === 'before' ? 'resource_open' : 'resource_recheck', scope: 'project', resource: 'skills', cause: 'metadata', changed: 32 });
        assert.equal(JSON.stringify(rejection).includes(canary), false);
        return true;
      });
      patched.mock.restore();
      assert.equal(await resourceIdentityAsync(f.cwd, f.pi), resourceIdentity(f.cwd, f.pi));
    } finally { patched.mock.restore(); f.close(); }
  });
}

test('resource I/O diagnostics preserve the original error but do not serialize its message or fields', async t => {
  const f = fixture(), file = join(f.cwd, '.pi', 'skills', `${canary}.md`);
  writeFileSync(file, canary);
  const handle = await fs.promises.open(file, 'r'), prototype = Object.getPrototypeOf(handle), read = prototype.read;
  await handle.close(); let injected = false;
  const failure = Object.assign(Error(canary), { path: file, code: canary, secret: canary });
  const patched = t.mock.method(prototype, 'read', async function(this: any, ...args: any[]) {
    if (!injected) { injected = true; throw failure; }
    return read.apply(this, args);
  });
  try {
    let rejection: Readonly<ExecutionRejection> | undefined;
    await assert.rejects(resourceIdentityAsync(f.cwd, f.pi, undefined, value => { rejection = value; }), error => {
      assert.equal(error, failure);
      assert.equal(rejection?.check, 'resource_scan'); assert.equal(rejection?.stage, 'resource_read'); assert.equal(rejection?.cause, 'io');
      assert.equal(JSON.stringify(rejection).includes(canary), false);
      return true;
    });
    patched.mock.restore();
    assert.equal(await resourceIdentityAsync(f.cwd, f.pi), resourceIdentity(f.cwd, f.pi));
  } finally { patched.mock.restore(); f.close(); }
});

test('read length mismatch reports length without a second stat or a metadata mask', async t => {
  const f = fixture(), file = join(f.cwd, '.pi', 'skills', 'length.md'); writeFileSync(file, canary);
  const inode = fs.statSync(file, { bigint: true }).ino, handle = await fs.promises.open(file, 'r'), prototype = Object.getPrototypeOf(handle);
  const stat = prototype.stat, read = prototype.read; await handle.close();
  const targets = new WeakSet<object>(); let stats = 0;
  const statMock = t.mock.method(prototype, 'stat', async function(this: any, ...args: any[]) {
    const value = await stat.apply(this, args);
    if (value.ino === inode) { targets.add(this); stats++; }
    return value;
  });
  const readMock = t.mock.method(prototype, 'read', async function(this: any, ...args: any[]) {
    return targets.has(this) ? { bytesRead: 0, buffer: args[0] } : read.apply(this, args);
  });
  const rejections: unknown[] = [];
  try {
    await assert.rejects(resourceIdentityAsync(f.cwd, f.pi, undefined, value => rejections.push(value)), /Resource changed during reading/);
    assert.equal(stats, 1);
    assert.deepEqual(rejections, [{ check: 'resource_scan', scope: 'project', resource: 'skills', stage: 'resource_read', cause: 'length' }]);
  } finally { statMock.mock.restore(); readMock.mock.restore(); f.close(); }
});

test('incomparable metadata omits changed rather than claiming no changed fields', async t => {
  const f = fixture(), file = join(f.cwd, '.pi', 'skills', 'missing.md'); writeFileSync(file, canary);
  const lstat = fs.lstatSync; let seen = 0;
  const patched = t.mock.method(fs, 'lstatSync', ((path: any, ...args: any[]) => {
    if (String(path) === file && ++seen === 2) return undefined;
    return (lstat as any)(path, ...args);
  }) as typeof fs.lstatSync);
  syncBuiltinESMExports(); const rejections: unknown[] = [];
  try {
    await assert.rejects(resourceIdentityAsync(f.cwd, f.pi, undefined, value => rejections.push(value)), /Resource changed during asynchronous inspection/);
    assert.deepEqual(rejections, [{ check: 'resource_scan', scope: 'project', resource: 'skills', stage: 'resource_final', cause: 'metadata' }]);
  } finally { patched.mock.restore(); syncBuiltinESMExports(); f.close(); }
});

test('shared errors remain identical without leaking context across concurrent scans or profile calls', async t => {
  const first = fixture(), second = fixture(), app = join(first.pi, 'skills'); mkdirSync(app);
  const files = [join(app, 'app.md'), join(second.cwd, '.pi', 'skills', 'project.md')];
  for (const file of files) writeFileSync(file, canary);
  const environments = await Promise.all([first.profiles.prepareAsync(first.input), second.profiles.prepareAsync(second.input)]);
  const inodes = new Set(files.map(file => fs.statSync(file, { bigint: true }).ino));
  const handle = await fs.promises.open(files[0], 'r'), prototype = Object.getPrototypeOf(handle), stat = prototype.stat, read = prototype.read;
  await handle.close(); const targets = new WeakSet<object>(), failure = Object.assign(Error(canary), { code: canary });
  const statMock = t.mock.method(prototype, 'stat', async function(this: any, ...args: any[]) {
    const value = await stat.apply(this, args); if (inodes.has(value.ino)) targets.add(this); return value;
  });
  const readMock = t.mock.method(prototype, 'read', async function(this: any, ...args: any[]) {
    if (targets.has(this)) throw failure;
    return read.apply(this, args);
  });
  try {
    const diagnostics: Readonly<ExecutionRejection>[][] = [[], []];
    const results = await Promise.allSettled([first, second].map((f, index) => resourceIdentityAsync(f.cwd, f.pi, undefined, value => diagnostics[index].push(value))));
    for (const result of results) { assert.equal(result.status, 'rejected'); if (result.status === 'rejected') assert.equal(result.reason, failure); }
    assert.deepEqual(diagnostics.map(values => values.map(value => value.scope)), [['app'], ['project']]);
    diagnostics.forEach(values => { values.length = 0; });
    assert.deepEqual(await Promise.all(environments.map((environment, index) => environment.currentAsync!(undefined, value => diagnostics[index].push(value)))), [false, false]);
    assert.deepEqual(diagnostics.map(values => values.map(value => value.scope)), [['app'], ['project']]);
    await assert.rejects(resourceIdentityAsync(first.cwd, first.pi, undefined, () => { throw Error('observer'); }), error => error === failure);
    assert.equal(JSON.stringify(diagnostics).includes(canary), false);
  } finally {
    statMock.mock.restore(); readMock.mock.restore(); environments.forEach(environment => environment.release()); first.close(); second.close();
  }
});

test('only the final escaping error is reported after close overrides a read failure', async t => {
  const f = fixture(), file = join(f.cwd, '.pi', 'skills', 'close.md'); writeFileSync(file, canary);
  const inode = fs.statSync(file, { bigint: true }).ino, handle = await fs.promises.open(file, 'r'), prototype = Object.getPrototypeOf(handle);
  const stat = prototype.stat, read = prototype.read; await handle.close();
  const targets = new WeakSet<object>(), originalRead = Error('read'), originalClose = Error('close');
  let closed = false;
  const readMock = t.mock.method(prototype, 'read', async function(this: any, ...args: any[]) {
    if (targets.has(this)) throw originalRead;
    return read.apply(this, args);
  });
  // FileHandle.close is an own property, so patch the targeted handle when stat first sees it.
  const closePatches: { mock: { restore(): void } }[] = [];
  const targetStatMock = t.mock.method(prototype, 'stat', async function(this: any, ...args: any[]) {
    const value = await stat.apply(this, args);
    if (value.ino === inode && !targets.has(this)) {
      targets.add(this); const original = this.close;
      closePatches.push(t.mock.method(this, 'close', async function(this: any) { await original.call(this); closed = true; throw originalClose; }));
    }
    return value;
  });
  const rejections: unknown[] = [];
  try {
    await assert.rejects(resourceIdentityAsync(f.cwd, f.pi, undefined, value => { assert.equal(closed, true); rejections.push(value); }), error => error === originalClose);
    assert.equal(closed, true); assert.equal(rejections.length, 1);
    assert.deepEqual(rejections, [{ check: 'resource_scan', scope: 'project', resource: 'skills', stage: 'resource_read', cause: 'io' }]);
  } finally { targetStatMock.mock.restore(); readMock.mock.restore(); closePatches.forEach(patch => patch.mock.restore()); f.close(); }
});

// assert.rejects returns its caught error from an async helper, which assimilates
// a revoked Proxy as a thenable before its identity predicate can run.
async function rejectsIdentity(promise: Promise<unknown>, original: unknown) {
  let rejected = false, actual: unknown;
  try { await promise; } catch (error) { rejected = true; actual = error; }
  assert.ok(rejected && actual === original, 'original thrown value survives');
}
for (const kind of ['throwing', 'revoked'] as const) {
  const hostile = () => {
    if (kind === 'throwing') return new Proxy({}, { getPrototypeOf() { throw Error(canary); } });
    const value = Proxy.revocable({}, {}); value.revoke(); return value.proxy;
  };
  test(`${kind} thrown proxy preserves identity through sync and async traversal`, async t => {
    const f = fixture(), original = fs.lstatSync, failure = hostile(), rejections: unknown[] = [];
    const patched = t.mock.method(fs, 'lstatSync', ((path: any, ...args: any[]) => {
      if (String(path) === join(f.cwd, 'AGENTS.md')) throw failure;
      return (original as any)(path, ...args);
    }) as typeof fs.lstatSync);
    syncBuiltinESMExports();
    try {
      assert.throws(() => resourceIdentity(f.cwd, f.pi, value => rejections.push(value)), error => error === failure);
      await rejectsIdentity(resourceIdentityAsync(f.cwd, f.pi, undefined, value => rejections.push(value)), failure);
      assert.deepEqual(rejections, Array.from({ length: 2 }, () => ({ check: 'resource_scan', scope: 'project', resource: 'instructions', stage: 'resource_traversal', cause: 'io' })));
      await rejectsIdentity(resourceIdentityAsync(f.cwd, f.pi, undefined, () => { throw Error('observer'); }), failure);
    } finally { patched.mock.restore(); syncBuiltinESMExports(); f.close(); }
  });
  for (const phase of ['read', 'close'] as const) test(`${kind} thrown proxy preserves final ${phase} identity after closing`, async t => {
    const f = fixture(), file = join(f.cwd, '.pi', 'skills', 'hostile.md'); writeFileSync(file, canary);
    const inode = fs.statSync(file, { bigint: true }).ino, handle = await fs.promises.open(file, 'r'), prototype = Object.getPrototypeOf(handle);
    const stat = prototype.stat, read = prototype.read; await handle.close();
    const targets = new WeakSet<object>(), failure = hostile(), rejections: unknown[] = [], closes: { mock: { restore(): void } }[] = [];
    let closed = 0;
    const observedClosed: number[] = [];
    const statMock = t.mock.method(prototype, 'stat', async function(this: any, ...args: any[]) {
      const value = await stat.apply(this, args);
      if (value.ino === inode && !targets.has(this)) {
        targets.add(this); const close = this.close;
        closes.push(t.mock.method(this, 'close', async function(this: any) {
          await close.call(this); closed++;
          if (phase === 'close') throw failure;
        }));
      }
      return value;
    });
    const readMock = t.mock.method(prototype, 'read', async function(this: any, ...args: any[]) {
      if (targets.has(this)) throw phase === 'read' ? failure : Error('earlier read failure');
      return read.apply(this, args);
    });
    try {
      await rejectsIdentity(resourceIdentityAsync(f.cwd, f.pi, undefined, value => { observedClosed.push(closed); rejections.push(value); }), failure);
      assert.equal(closed, 1);
      assert.deepEqual(rejections, [{ check: 'resource_scan', scope: 'project', resource: 'skills', stage: 'resource_read', cause: 'io' }]);
      await rejectsIdentity(resourceIdentityAsync(f.cwd, f.pi, undefined, () => { observedClosed.push(closed); throw Error('observer'); }), failure);
      assert.equal(closed, 2);
      assert.deepEqual(observedClosed, [1, 2]);
    } finally { statMock.mock.restore(); readMock.mock.restore(); closes.forEach(close => close.mock.restore()); f.close(); }
  });
}

test('primitive throws survive the public scan boundary and observer failures', async t => {
  const f = fixture(), original = fs.lstatSync;
  const patched = t.mock.method(fs, 'lstatSync', ((path: any, ...args: any[]) => {
    if (String(path) === join(f.cwd, 'AGENTS.md')) throw canary;
    return (original as any)(path, ...args);
  }) as typeof fs.lstatSync);
  syncBuiltinESMExports(); const rejections: unknown[] = [];
  try {
    assert.throws(() => resourceIdentity(f.cwd, f.pi, value => rejections.push(value)), error => error === canary);
    await assert.rejects(resourceIdentityAsync(f.cwd, f.pi, undefined, () => { throw Error('observer'); }), error => error === canary);
    assert.deepEqual(rejections, [{ check: 'resource_scan', scope: 'project', resource: 'instructions', stage: 'resource_traversal', cause: 'io' }]);
  } finally { patched.mock.restore(); syncBuiltinESMExports(); f.close(); }
});
