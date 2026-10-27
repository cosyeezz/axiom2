import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync } from 'node:fs';
import { testShard, runTests } from './test-ci.mjs';

test('all real TypeScript tests appear exactly once in four nonempty deterministic shards', () => {
  const files = readdirSync(new URL('../app/tests/', import.meta.url)).filter(name => name.endsWith('.test.ts'));
  const shards = [1, 2, 3, 4].map(i => testShard(files, `${i}/4`));
  assert.ok(shards.every(shard => shard.length > 0));
  assert.deepEqual(shards.flat().sort(), [...files].sort());
  assert.equal(new Set(shards.flat()).size, files.length);
  assert.ok(Math.max(...shards.map(s => s.length)) - Math.min(...shards.map(s => s.length)) <= 1);
  assert.deepEqual(testShard([...files].reverse(), '1/4'), shards[0]);
  for (const invalid of ['', '0/4', '5/4', '1/0', '1/33', '1', 'NaN/4']) assert.throws(() => testShard(files, invalid));
  assert.throws(() => testShard(['duplicate', 'duplicate'], '1/4'));
});
test('foreground tests run exactly once and TypeScript shards run serially with the existing asset hooks', () => {
  const calls = [];
  for (let i = 1; i <= 4; i++) assert.equal(runTests(`${i}/4`, undefined, (exec, args, options) => { calls.push({ exec, args, options }); return { status: 0 }; }), 0);
  assert.equal(calls.length, 5);
  assert.equal(calls.filter(call => call.args.includes('tests/foreground-service.test.mjs')).length, 1);
  for (const call of calls.filter(c => c.args.includes('tsx'))) {
    assert.ok(call.args.includes('--test-concurrency=1'));
    assert.ok(call.args.includes('./tests/vite-assets.mjs'));
    assert.equal(call.options.stdio, 'inherit');
  }
});
test('test failures, signals, and spawn errors are not swallowed', () => {
  assert.equal(runTests('2/4', undefined, () => ({ status: 9 })), 9);
  assert.equal(runTests('2/4', undefined, () => ({ status: null, signal: 'SIGTERM' })), 1);
  assert.throws(() => runTests('2/4', undefined, () => ({ error: new Error('spawn failed') })), /spawn failed/);
  let called = 0;
  assert.equal(runTests('1/4', undefined, () => { called++; return { status: 2 }; }), 2);
  assert.equal(called, 1);
});
