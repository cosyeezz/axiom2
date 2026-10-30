// Child-only network fixture. No sockets, real credentials, or external requests.
const { appendFileSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { Socket } = require('node:net');
const root = process.env.AXIOM_CODEX_FIXTURE_DIR;
if (!root) throw Error('Codex fixture directory missing');
Socket.prototype.connect = function () { throw Error('External sockets forbidden'); };
const fixtureFetch = async (input, init) => {
  init.signal.throwIfAborted();
  const url = new URL(input), headers = new Headers(init.headers);
  const config = JSON.parse(readFileSync(join(root, 'network-fixture.json'), 'utf8'));
  const entry = config.tokens[headers.get('authorization')?.replace(/^Bearer /, '')];
  if (url.origin !== 'https://chatgpt.com' || init.method !== 'GET' || init.redirect !== 'error' || !entry || headers.get('chatgpt-account-id') !== entry.account) throw Error('Unexpected Codex query or credential');
  for (const [name, value] of Object.entries({ 'openai-beta': 'codex-1', originator: 'Codex Desktop', 'oai-language': 'zh-CN' })) if (headers.get(name) !== value) throw Error('Missing Codex header');
  appendFileSync(join(root, 'codex-requests.jsonl'), JSON.stringify({ slot: entry.slot, path: url.pathname, proxy: process.env.HTTPS_PROXY, worker: process.env.AXIOM_MODEL_NETWORK_WORKER }) + '\n');
  const body = url.pathname === '/backend-api/wham/usage' ? {
    email: `${entry.slot.toLowerCase()}@example.test`, plan_type: 'pro',
    rate_limit: { allowed: true, limit_reached: false, primary_window: { used_percent: 37.5, limit_window_seconds: 18000, reset_after_seconds: 3600 }, secondary_window: { used_percent: 50, limit_window_seconds: 604800, reset_after_seconds: 86400 } },
    additional_rate_limits: [{ metered_feature: 'codex_spark', rate_limit: { allowed: false, limit_reached: true, primary_window: { used_percent: 100, limit_window_seconds: 18000, reset_after_seconds: 3600 } } }],
    credits: { has_credits: true, unlimited: false, balance: entry.balance }, private: 'FIXTURE_PRIVATE_RAW',
  } : url.pathname === '/backend-api/wham/rate-limit-reset-credits' ? { available_count: 3, credits: [
    { id: 'FIXTURE_PRIVATE_CARD', status: 'available', reset_type: 'codex_rate_limits', expires_at: '2099-02-01T00:00:00Z' },
    { id: 'FIXTURE_PRIVATE_CARD_2', status: 'available', expires_at: '2099-01-01T00:00:00Z' },
    { id: 'FIXTURE_PRIVATE_CARD_3', status: 'available', expires_at: '2099-03-01T00:00:00Z' },
    { id: 'FIXTURE_PRIVATE_REDEEMED', status: 'redeemed', expires_at: '2099-01-01T00:00:00Z' }, {},
  ] } : url.pathname === '/backend-api/accounts/check/v4-2023-04-27' ? { accounts: {
    [entry.account]: { account: { account_id: entry.account, plan_type: 'pro' }, entitlement: { expires_at: '2098-06-01T00:00:00Z' } },
    'other-workspace': { account: { account_id: 'other-workspace', plan_type: 'team', is_default: true }, entitlement: { expires_at: '2099-01-01T00:00:00Z' } },
  } } : undefined;
  if (!body) throw Error('Unexpected endpoint');
  return new Response(JSON.stringify(body));
};
Object.defineProperty(globalThis, 'fetch', { configurable: true, get: () => fixtureFetch, set() {} });
