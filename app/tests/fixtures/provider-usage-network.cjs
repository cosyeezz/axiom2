// Child-only fixture: no real sockets or real OAuth credentials.
const { appendFileSync } = require('node:fs');
const { join } = require('node:path');
const { Socket } = require('node:net');
const root = process.env.AXIOM_USAGE_FIXTURE_DIR;
if (!root) throw Error('Usage fixture root missing');
Socket.prototype.connect = function () { throw Error('External sockets forbidden'); };
const fixtureFetch = async (input, init) => {
  init.signal.throwIfAborted();
  const url = new URL(input);
  if (url.origin !== 'https://chatgpt.com' || init.method !== 'GET' || init.redirect !== 'error') throw Error('Unexpected request');
  const headers = new Headers(init.headers);
  if (headers.get('authorization') !== 'Bearer PRIVATE_ACCESS' || headers.get('chatgpt-account-id') !== 'PRIVATE_ACCOUNT') throw Error('Missing auth');
  appendFileSync(join(root, 'usage-requests.jsonl'), JSON.stringify({ path: url.pathname, proxy: process.env.HTTPS_PROXY, worker: process.env.AXIOM_MODEL_NETWORK_WORKER }) + '\n');
  const body = url.pathname === '/backend-api/wham/usage'
    ? { rate_limit: { primary_window: { used_percent: 37, limit_window_seconds: 18000 } }, credits: { balance: '4.2500', has_credits: true } }
    : url.pathname === '/backend-api/wham/rate-limit-reset-credits'
      ? { available_count: 2, credits: [{ id: 'PRIVATE_CARD', expires_at: '2099-01-01T00:00:00Z' }] }
      : url.pathname === '/backend-api/accounts/check/v4-2023-04-27'
        ? { accounts: { PRIVATE_ACCOUNT: { account: { account_id: 'PRIVATE_ACCOUNT', plan_type: 'pro' }, entitlement: { expires_at: '2098-06-01T00:00:00Z' } } } } : undefined;
  if (!body) throw Error('Unexpected endpoint');
  return new Response(JSON.stringify(body));
};
Object.defineProperty(globalThis, 'fetch', { configurable: true, get: () => fixtureFetch, set() {} });
