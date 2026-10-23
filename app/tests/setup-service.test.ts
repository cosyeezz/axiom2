import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
const { checksum, downloadFile, installService } = await import(new URL('../desktop/setup-service.mjs', import.meta.url).href);
const bytes = Buffer.from('offline verified package');
const digest = createHash('sha256').update(bytes).digest('hex');
const base = 'https://github.com/cosyeezz/axiom2/releases/download/v0.4.99/';

test('checksums accept UTF-8 BOM, CRLF, binary marker and multiple files but reject duplicate/missing entries', () => {
  assert.equal(checksum(`\ufeff${digest.toUpperCase()} *axiom2.tgz\r\n${digest}  Axiom2.dmg\r\n`), digest);
  assert.throws(() => checksum(`${digest}  other.tgz`), /实际 0 条/);
  assert.throws(() => checksum(`${digest}  axiom2.tgz\n${digest}  axiom2.tgz`), /实际 2 条/);
});
for (const problem of ['none', 'size', 'hash', 'manifest', 'http'] as const) {
  test(`bootstrap explicitly decodes binary checksum response and refuses invalid downloads: ${problem}`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'axiom-setup-')); t.after(() => rm(root, { recursive: true, force: true }));
    const calls: string[][] = [];
    const fetcher = async (url: string) => {
      if (url.endsWith('/latest')) return new Response(JSON.stringify({ tag_name: 'v0.4.99', assets: ['axiom2.tgz', 'SHA256SUMS'].map(name => ({ name, size: bytes.length + (problem === 'size' ? 1 : 0), browser_download_url: base + name })) }));
      if (url.endsWith('SHA256SUMS')) return new Response(Buffer.from(`\ufeff${problem === 'hash' ? '0'.repeat(64) : digest}  ${problem === 'manifest' ? 'other' : 'axiom2'}.tgz\r\n`), { headers: { 'Content-Type': 'application/octet-stream' } });
      assert.equal(url, base + 'axiom2.tgz');
      return problem === 'http' ? new Response('blocked', { status: 403 }) : new Response(bytes);
    };
    const run = () => installService({ root, fetcher, runner: async (args: string[]) => { calls.push(args); return JSON.stringify({ state: 'running' }); } });
    if (problem === 'none') { await run(); assert.equal(calls.length, 2); assert.deepEqual(await readFile(join(root, 'setup/axiom2.tgz')), bytes); }
    else {
      await assert.rejects(run, problem === 'size' ? /大小不符.*预期.*实际/ : problem === 'hash' ? /SHA-256 不符.*预期.*实际/ : problem === 'manifest' ? /校验清单无效/ : /HTTP 403/);
      assert.equal(calls.length, 0); await assert.rejects(access(join(root, 'setup/axiom2.tgz')));
    }
  });
}
test('stream download reports received bytes, real size, speed and idle heartbeat before completion', async t => {
  const root = await mkdtemp(join(tmpdir(), 'axiom-download-')); t.after(() => rm(root, { recursive: true, force: true }));
  const values: any[] = [];
  const stream = new ReadableStream({ async start(controller) { controller.enqueue(bytes.subarray(0, 4)); await new Promise(resolve => setTimeout(resolve, 1100)); controller.enqueue(bytes.subarray(4)); controller.close(); } });
  await downloadFile(base + 'axiom2.tgz', join(root, 'archive'), { size: bytes.length, digest, fetcher: async () => new Response(stream), onProgress: (value: any) => values.push(value) });
  assert.equal(values[0].downloaded, 0); assert.ok(values.some(p => p.downloaded === 4));
  assert.equal(values.at(-1).downloaded, bytes.length);
  assert.ok(values.every(p => p.total === bytes.length && p.speed >= 0 && p.updatedAt >= p.lastByteAt));
});
test('network timeout reports the exact received byte count and closes the output file', async t => {
  const root = await mkdtemp(join(tmpdir(), 'axiom-timeout-')); t.after(() => rm(root, { recursive: true, force: true }));
  const server = createServer((_req, res) => { res.writeHead(200); res.write(bytes.subarray(0, 4)); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address() as { port: number };
  await assert.rejects(downloadFile(`http://127.0.0.1:${address.port}/archive`, join(root, 'archive'), { size: bytes.length, digest, timeoutMs: 300, onProgress: () => {} }), /已接收 4\//);
  await rm(join(root, 'archive'));
});
