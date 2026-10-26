import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const { createUpdaterSupervisor, updaterOwnerPath } = await import(new URL('../desktop/updater-supervision.mjs', import.meta.url).href);
const { desktopTask, DesktopExecution } = await import(new URL('../desktop/maintenance.mjs', import.meta.url).href);
const darwin = { skip: process.platform !== 'darwin', timeout: 20000 };

async function fixture(t: TestContext, source: string) {
  const root = await mkdtemp(join(tmpdir(), 'axiom-service-request-'));
  const cli = join(root, 'cli.mjs'), marker = join(root, 'admitted.json');
  await writeFile(cli, source);
  const task = desktopTask('service', 'update');
  let supervisor: ReturnType<typeof createUpdaterSupervisor> | undefined;
  const execution = new DesktopExecution(task, (snapshot: typeof task) => supervisor?.publish(snapshot));
  supervisor = createUpdaterSupervisor({ root, execution });
  t.after(async () => {
    await execution.finish();
    await supervisor?.release();
    await rm(root, { recursive: true, force: true });
  });
  await supervisor.prepare();
  return { root, cli, marker, task, execution, supervisor, options: { env: { ...process.env, AXIOM_TEST_REQUEST_ROOT: root, AXIOM_TEST_REQUEST_ID: task.id } } };
}

const admitted = `
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.env.AXIOM_TEST_REQUEST_ROOT;
const directory = join(root, 'updates', 'tasks', process.env.AXIOM_TEST_REQUEST_ID);
const manifest = JSON.parse(readFileSync(join(directory, 'supervision.json'), 'utf8'));
const request = manifest.services.find(item => item.pid === process.pid);
assert.equal(request.state, 'armed');
const owner = JSON.parse(readFileSync(join(directory, 'service-' + request.id, 'owner.json'), 'utf8'));
assert.equal(owner.state, 'armed');
assert.equal(owner.id, request.ownerId);
assert.equal(owner.identity.platform, 'darwin');
assert.equal(owner.identity.workerPid, process.pid);
assert.ok(owner.identity.started);
assert.deepEqual(owner.identity.members, [{pid: process.pid, started: owner.identity.started}]);
writeFileSync(join(root, 'admitted.json'), JSON.stringify({pid: process.pid, requestId: request.id}));
`;

test('Darwin service request persists its own PID identity before GO and clears its lease after exit', darwin, async t => {
  const f = await fixture(t, admitted + `process.stdout.write(JSON.stringify({state:'running',pid:12345}));`);
  assert.deepEqual(await f.supervisor.start(process.execPath, [f.cli, 'start', '--json'], f.options), { state: 'running', pid: 12345 });
  const request = JSON.parse(await readFile(f.marker, 'utf8'));
  assert.notEqual(request.pid, process.pid);
  await assert.rejects(access(join(f.root, 'updates', 'tasks', f.task.id, `service-${request.requestId}`, 'owner.json')), { code: 'ENOENT' });
  assert.equal(f.supervisor.uncertain(), false);
  await f.supervisor.release();
  await assert.rejects(access(updaterOwnerPath(f.root)), { code: 'ENOENT' });
});

test('Darwin unsupported service arguments never admit a business CLI', darwin, async t => {
  const f = await fixture(t, admitted);
  await assert.rejects(f.supervisor.start(process.execPath, [f.cli, 'stop', '--json'], f.options), { code: 'stop-unconfirmed' });
  await assert.rejects(access(f.marker), { code: 'ENOENT' });
});

test('Darwin pre-cancelled service request never admits a business CLI', darwin, async t => {
  const f = await fixture(t, admitted);
  f.execution.abort('cancelled', 'test cancellation before start');
  await assert.rejects(f.supervisor.start(process.execPath, [f.cli, 'start', '--json'], f.options), { code: 'cancelled' });
  await assert.rejects(access(f.marker), { code: 'ENOENT' });
});

test('Darwin cancelled service request retains uncertainty even after the owned request closes', darwin, async t => {
  const f = await fixture(t, admitted + `setInterval(()=>{},1000);`);
  const pending = f.supervisor.start(process.execPath, [f.cli, 'start', '--json'], f.options);
  void pending.catch(() => {});
  try {
    const deadline = Date.now() + 10000;
    while (true) {
      try { await access(f.marker); break; } catch { assert.ok(Date.now() < deadline, 'request was admitted'); await delay(25); }
    }
    f.execution.abort('cancelled', 'test cancellation after admission');
    await assert.rejects(pending, { code: 'stop-unconfirmed' });
    const directory = join(f.root, 'updates', 'tasks', f.task.id);
    const manifest = JSON.parse(await readFile(join(directory, 'supervision.json'), 'utf8'));
    const request = manifest.services[0];
    assert.equal(request.state, 'closed');
    assert.equal(request.requestStopped, true);
    await assert.rejects(access(join(directory, `service-${request.id}`, 'owner.json')), { code: 'ENOENT' });
    assert.equal(f.supervisor.uncertain(), true);
    await f.supervisor.release();
    await access(updaterOwnerPath(f.root));
  } finally {
    f.execution.abort('cancelled', 'test cleanup');
    await pending.catch(() => {});
  }
});
