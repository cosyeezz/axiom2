// Verification only: never imports CHECK/PREFLIGHT, reads credentials, or sends requests.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const read = name => readFileSync(join(root, name));
const json = name => JSON.parse(read(name).toString('utf8'));
const sha = value => createHash('sha256').update(value).digest('hex');
const initial = json('static-windows.json');
const source = readFileSync(initial.source);
assert.equal(source.length, initial.sourceBytes);
assert.equal(sha(source), initial.sourceSha256);
const ranges = [...initial.windows, { name: 'account-query', startByte: 18137247, endByteExclusive: 18139560 },
  { name: 'endpoint-interceptor', startByte: 21540400, endByteExclusive: 21542000 }];
for (const window of ranges) {
  const raw = source.subarray(window.startByte, window.endByteExclusive);
  assert.equal(read(window.name + '.txt').toString('utf8'), raw.toString('utf8'));
  if (window.sha256) assert.equal(sha(raw), window.sha256);
}
const preflight = json('preflight.json'), selftest = json('selftest.json'), live = json('PROJECTION.json');
assert.equal(preflight.passed, true);
assert.equal(preflight.type, 'oauth');
assert.equal(preflight.expired, false);
assert.equal(preflight.storedFilesUnchanged, true);
assert.equal(preflight.deniedNetworkOrProcessCalls, 0);
assert.equal(selftest.passed, true);
assert.equal(selftest.scriptSha256, sha(read('CHECK.mjs')));
assert.equal(selftest.liveRequests, 0);
assert.equal(live.passed, true);
assert.equal(live.requests, 1);
assert.equal(live.httpStatus, 200);
assert.equal(live.businessCode, 0);
for (const name of ['accountsPresent', 'requestClosed', 'storedFilesUnchanged', 'currentAccountRouteUnchanged']) assert.equal(live[name], true);
for (const name of ['modelRequests', 'refreshRequests', 'deniedUnexpectedIO']) assert.equal(live[name], 0);
assert.equal(live.officialCliExecuted, false);
assert.equal(live.cliCredentialsWritten, false);
assert.equal(json('live.claim').maxAccountRequests, 1);
for (const name of ['preflight.stderr', 'selftest.stderr', 'live.stderr']) assert.equal(read(name).length, 0);
let links = 0;
for (const match of read('REPORT.md').toString('utf8').matchAll(/\]\(([^)]+)\)/g)) {
  const target = resolve(root, match[1]);
  assert.ok(target.startsWith(root + '/'));
  if (match[1] !== 'final-readback.json') assert.ok(existsSync(target));
  links++;
}
const productRoot = dirname(dirname(initial.source));
const cn = JSON.parse(readFileSync(join(productRoot, 'product.internal.json'), 'utf8'));
const product = JSON.parse(readFileSync(join(productRoot, 'product.json'), 'utf8'));
assert.equal(cn.endpoint, 'https://copilot.tencent.com');
assert.equal(product.authentication.attributes.prefixPath, '/plugin');
const names = ['CONTRACT.md', 'REPORT.md', 'PREFLIGHT.mjs', 'CHECK.mjs', 'VERIFY.mjs',
  'preflight.json', 'selftest.json', 'PROJECTION.json', 'live.claim', 'static-windows.json',
  ...ranges.map(window => window.name + '.txt')];
const output = { passed: true, reportLinks: links, officialWindowsMatched: ranges.length,
  sourceSha256: sha(source), selftestScriptUnchanged: true,
  liveClaimSpent: true, noLiveOrSelftestRerun: true,
  scope: 'Evidence readback; original account GET was independent of CLI startup',
  files: names.map(path => ({ path, sha256: sha(read(path)), bytes: read(path).length })) };
writeFileSync(join(root, 'final-readback.json'), JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ passed: true, links, windows: ranges.length, files: names.length }));
