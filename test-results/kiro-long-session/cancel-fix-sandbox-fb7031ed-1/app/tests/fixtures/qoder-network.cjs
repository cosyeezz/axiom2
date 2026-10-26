// Isolated child-process fixture: no real sockets, credentials or provider access.
const { existsSync, appendFileSync } = require('node:fs');
const { join } = require('node:path');
const { Socket } = require('node:net');
const root = process.env.AXIOM_QODER_FIXTURE_DIR;
if (!root) throw new Error('Qoder fixture directory missing');
Socket.prototype.connect = function () { throw new Error('External sockets are forbidden in the Qoder fixture'); };
const fixtureFetch = async (input, init) => {
  init?.signal?.throwIfAborted();
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!['https://openapi.qoder.com.cn', 'https://gateway.qoder.com.cn'].includes(url.origin)) throw new Error('Unexpected Qoder fixture origin');
  appendFileSync(join(root, 'requests.jsonl'), JSON.stringify({ path: url.pathname, worker: process.env.AXIOM_MODEL_NETWORK_WORKER }) + '\n');
  let body;
  if (url.pathname === '/api/v1/deviceToken/poll') {
    if (!existsSync(join(root, 'browser-opened'))) return new Response(null, { status: 202 });
    body = { token: 'dt-FIXTURE', refresh_token: 'refresh-FIXTURE', user_id: 'fixture-user', expires_in: 3600 };
  } else if (url.pathname === '/algo/api/v5/service/region/endpoints') {
    body = { inferNodes: ['https://gateway.qoder.com.cn'] };
  } else if (url.pathname === '/algo/api/v2/model/list') {
    if (!new Headers(init?.headers).get('authorization')?.startsWith('Bearer COSY.')) throw new Error('Missing COSY signature');
    body = { chat: [{ key: 'auto', display_name: 'Auto fixture', max_input_tokens: 64000, max_output_tokens: 1024, source: 'system' }] };
  } else throw new Error('Unexpected Qoder fixture request');
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
};
// Network bootstrap installs undici globally; retain the fixture on that assignment.
Object.defineProperty(globalThis, 'fetch', { configurable: true, get: () => fixtureFetch, set() {} });
