import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export function testShard(files, spec) {
  assert.match(spec, /^[1-9]\d*\/[1-9]\d*$/);
  const [index, total] = spec.split('/').map(Number);
  assert.ok(index <= total && total <= 32, 'Invalid test shard');
  const sorted = [...files].sort();
  assert.equal(new Set(sorted).size, sorted.length, 'Duplicate test files');
  return sorted.filter((_, position) => position % total === index - 1);
}
export function runTests(spec, root = fileURLToPath(new URL('../app/', import.meta.url)), execute = spawnSync) {
  const files = readdirSync(resolve(root, 'tests')).filter(name => name.endsWith('.test.ts')).map(name => `tests/${name}`);
  const selected = testShard(files, spec);
  assert.ok(selected.length, 'Empty test shard');
  const commands = [];
  if (spec.startsWith('1/')) commands.push(['--test', 'tests/foreground-service.test.mjs']);
  commands.push(['--import', 'tsx', '--import', './tests/vite-assets.mjs', '--test', '--test-concurrency=1', ...selected]);
  console.log(`CI shard ${spec}: ${selected.length}/${files.length} TypeScript test files; concurrency=1`);
  for (const args of commands) {
    const result = execute(process.execPath, args, { cwd: root, stdio: 'inherit', env: process.env });
    if (result.error) throw result.error;
    if (result.signal || result.status !== 0) return result.status || 1;
  }
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = runTests(process.argv[2]);
