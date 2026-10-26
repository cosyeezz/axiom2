// Preloaded in the model network worker; never delegate fixture traffic to real sockets.
const { existsSync, appendFileSync } = require('node:fs');
const { join } = require('node:path');
const { Socket } = require('node:net');
const root = process.env.AXIOM_CODEBUDDY_FIXTURE_DIR;
if (!root) throw new Error('CodeBuddy fixture directory missing');
Socket.prototype.connect = function () { throw new Error('External sockets are forbidden in the CodeBuddy fixture'); };
const fixtureFetch = async (input, init) => {
  init?.signal?.throwIfAborted();
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.origin !== 'https://copilot.tencent.com') throw new Error(`Unexpected fixture origin: ${url.origin}`);
  let body;
  if (url.pathname === '/v2/plugin/auth/state' && url.search === '?platform=CLI' && init?.method === 'POST') {
    body = { code: 0, data: { state: 'fixture', authUrl: 'https://copilot.tencent.com/login?fixture' } };
  } else if (url.pathname === '/v2/plugin/auth/token' && url.search === '?state=fixture' && init?.method === 'GET') {
    body = existsSync(join(root, 'browser-opened'))
      ? { code: 0, data: { accessToken: 'FIXTURE-ACCESS', refreshToken: 'FIXTURE-REFRESH', expiresIn: 3600 } }
      : { code: 11217 };
  } else throw new Error(`Unexpected fixture request: ${init?.method} ${url.pathname}`);
  appendFileSync(join(root, 'requests.jsonl'), JSON.stringify({ method: init.method, path: url.pathname, worker: process.env.AXIOM_MODEL_NETWORK_WORKER }) + '\n');
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
};
// configureModelNetwork calls undici.install(); retain the fixture across that assignment.
Object.defineProperty(globalThis, 'fetch', { configurable: true, get: () => fixtureFetch, set() {} });
