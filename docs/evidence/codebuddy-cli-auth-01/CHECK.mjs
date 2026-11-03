import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import childProcess from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
const endpoint = 'https://copilot.tencent.com/v2/plugin/accounts';
const realRequest = https.request;
const here = fileURLToPath(new URL('.', import.meta.url));
const repo = fileURLToPath(new URL('../../../', import.meta.url));

export function projectResponse(status, bytes) {
  let body;
  try { body = JSON.parse(bytes.toString('utf8')); }
  catch { return { passed: false, httpStatus: status, code: 'INVALID_JSON' }; }
  const businessCode = Number.isSafeInteger(body?.code) ? body.code : null;
  const accountsPresent = Array.isArray(body?.data?.accounts) && body.data.accounts.length > 0;
  return { passed: status >= 200 && status < 300 && businessCode === 0 && accountsPresent,
    httpStatus: status, businessCode, accountsPresent };
}

export async function requestAccount(access, send, { maxBytes = 1048576, timeoutMs = 15000 } = {}) {
  if (typeof access !== 'string' || !access || access.length > 16384 || /[\r\n]/.test(access))
    return { passed: false, code: 'INVALID_ACCESS_SHAPE', requests: 0, requestClosed: true };
  let request, response, timer, requestClosed = false, responseBytes = 0, requests = 0;
  let resolveClosed;
  const closed = new Promise(resolve => { resolveClosed = resolve; });
  let timedOut = false;
  let result;
  try {
    response = await new Promise((resolveResponse, reject) => {
      requests++;
      request = send(endpoint, { method: 'GET', agent: false, rejectUnauthorized: true, maxHeaderSize: 16384, headers: {
        Authorization: `Bearer ${access}`, 'X-Domain': 'copilot.tencent.com',
        Accept: 'application/json', 'X-Product': 'SaaS',
        'User-Agent': 'Axiom-CodeBuddy-Auth-Check/1', Connection: 'close',
      } }, resolveResponse);
      request.once('close', () => { requestClosed = true; resolveClosed(); });
      request.once('error', reject);
      timer = setTimeout(() => {
        timedOut = true;
        response?.destroy();
        request.destroy(new Error('TIME_LIMIT'));
      }, timeoutMs);
      request.end();
    });
    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400) {
      result = { passed: false, httpStatus: status, code: 'REDIRECT_REJECTED' };
    } else {
      const chunks = [];
      for await (const chunk of response) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        responseBytes += bytes.length;
        if (responseBytes > maxBytes) throw new Error('RESPONSE_LIMIT');
        chunks.push(bytes);
      }
      result = projectResponse(status, Buffer.concat(chunks));
    }
  } catch {
    result = { passed: false, code: timedOut ? 'TIME_LIMIT' : responseBytes > maxBytes ? 'RESPONSE_LIMIT' : 'REQUEST_FAILED' };
  } finally {
    clearTimeout(timer);
    response?.destroy();
    if (request) {
      request.destroy();
      await closed;
    } else { requestClosed = true; }
  }
  return { ...result, requests, responseBytes, requestClosed };
}

function forbidIO() {
  let denied = 0;
  const deny = () => { denied++; throw new Error('IO_FORBIDDEN'); };
  globalThis.fetch = deny;
  http.request = http.get = https.request = https.get = deny;
  for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[key] = deny;
  syncBuiltinESMExports();
  return () => denied;
}

export async function selftest() {
  const denied = forbidIO();
  net.Socket.prototype.connect = () => { throw new Error('SOCKET_FORBIDDEN'); };
  let sends = 0;
  const mock = (status, value, hang = false) => (url, options, callback) => {
    sends++;
    assert.equal(url, endpoint);
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.Authorization, 'Bearer SYNTHETIC_TOKEN');
    assert.equal(options.agent, false);
    let destroyed = false;
    const request = new EventEmitter();
    request.end = () => { if (!hang) queueMicrotask(() => {
      const response = Readable.from([Buffer.from(value)]);
      response.statusCode = status;
      callback(response);
    }); };
    request.destroy = error => { if (!destroyed) {
      destroyed = true;
      queueMicrotask(() => { if (error) request.emit('error', error); request.emit('close'); });
    } };
    return request;
  };
  const cases = [
    [200, '{"code":0,"data":{"accounts":[{"private":"DO_NOT_OUTPUT"}]}}', true],
    [401, '{"code":401,"data":{"accounts":[{}]}}', false],
    [200, '{"code":123,"data":{"accounts":[{}]}}', false],
    [200, '{"code":0,"data":{"accounts":[]}}', false],
    [200, '{"code":0,"data":{"accounts":"invalid"}}', false],
    [200, 'not json DO_NOT_OUTPUT', false],
    [302, 'DO_NOT_OUTPUT', false],
  ];
  for (const [status, value, passed] of cases) {
    const result = await requestAccount('SYNTHETIC_TOKEN', mock(status, value));
    assert.equal(result.passed, passed);
    assert.equal(result.requestClosed, true);
    assert.ok(!JSON.stringify(result).includes('DO_NOT_OUTPUT'));
  }
  const large = await requestAccount('SYNTHETIC_TOKEN', mock(200, 'too big'), { maxBytes: 2 });
  assert.equal(large.code, 'RESPONSE_LIMIT');
  const timeout = await requestAccount('SYNTHETIC_TOKEN', mock(200, '', true), { timeoutMs: 5 });
  assert.equal(timeout.code, 'TIME_LIMIT');
  assert.equal(timeout.requestClosed, true);
  const invalid = await requestAccount('bad\r\nvalue', mock(200, '{}'));
  assert.equal(invalid.requests, 0);
  assert.equal(sends, 9);
  assert.equal(denied(), 0);
  return { phase: 'selftest', passed: true, scriptSha256: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'), syntheticSends: sends, liveRequests: 0,
    assertions: ['success', 'HTTP401', 'business-code', 'empty-accounts', 'invalid-accounts', 'invalid-json', 'redirect', 'body-limit', 'timeout', 'header-injection', 'redacted-output', 'closed-resources'] };
}

async function live() {
  const proof = JSON.parse(readFileSync(join(here, 'selftest.json'), 'utf8'));
  assert.equal(proof.passed, true);
  assert.equal(proof.scriptSha256, createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'));
  const denied = forbidIO();
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = () => { throw new Error('IMPORT_NETWORK_FORBIDDEN'); };
  delete process.env.AXIOM_EXECUTION_PROFILE;
  delete process.env.AXIOM_MODEL_ACCOUNT_BINDINGS;
  const dir = process.env.AXIOM_PI_DIR;
  assert.ok(dir && resolve(dir) === dir);
  const { selectedAuthPath, readModelCredential } = await import(pathToFileURL(join(repo, 'app/dist/server/model-account-storage.js')).href);
  const provider = 'codebuddy-cn', authPath = join(dir, 'auth.json');
  const selected = selectedAuthPath(provider, authPath);
  const paths = [selected, join(dir, 'model-accounts/index.json'), join(dir, 'models.json'), join(dir, 'settings.json')];
  const read = path => existsSync(path) ? readFileSync(path) : undefined;
  const before = paths.map(read);
  const credential = readModelCredential(provider, authPath);
  assert.equal(credential?.type, 'oauth');
  assert.ok(Number.isFinite(credential.expires) && credential.expires > Date.now() + 60000);
  assert.equal(selectedAuthPath(provider, authPath), selected);
  // Store only the claim timestamp; never store credentials or their fingerprints.
  writeFileSync(join(here, 'live.claim'), JSON.stringify({ at: new Date().toISOString(), maxAccountRequests: 1, maxModelRequests: 0 }) + '\n', { flag: 'wx', mode: 0o600 });
  net.Socket.prototype.connect = connect;
  let sends = 0;
  const result = await requestAccount(credential.access, (url, options, callback) => {
    assert.equal(++sends, 1);
    assert.equal(url, endpoint);
    return realRequest(url, options, callback);
  });
  const unchanged = paths.every((path, i) => {
    const after = read(path);
    return before[i] === undefined ? after === undefined : after !== undefined && before[i].equals(after);
  });
  const sameRoute = selectedAuthPath(provider, authPath) === selected;
  return { phase: 'live-account-check', ...result, passed: result.passed && unchanged && sameRoute && denied() === 0,
    storedFilesUnchanged: unchanged, currentAccountRouteUnchanged: sameRoute,
    deniedUnexpectedIO: denied(), modelRequests: 0, refreshRequests: 0,
    officialCliExecuted: false, cliCredentialsWritten: false,
    limit: 'Independent account-token validation; CLI token entrance statically verified, not full CLI startup or wire parity' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let result;
  try {
    if (process.argv[2] === '--selftest') result = await selftest();
    else if (process.argv[2] === '--live') result = await live();
    else throw new Error('MODE_REQUIRED');
  } catch { result = { passed: false, code: 'CHECK_FAILED' }; }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (!result.passed) process.exitCode = 1;
}
