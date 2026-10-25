// Preloaded into model-network workers. Every socket is blocked; only explicitly
// modeled auth/catalog requests can succeed, including after undici.install().
const { appendFileSync } = require('node:fs');
const { join } = require('node:path');
require('node:net').Socket.prototype.connect = function () { throw new Error('Unexpected socket in Kiro fixture'); };
const mock = async (input, init) => {
  const url = new URL(String(input));
  if (!['https://oidc.us-east-1.amazonaws.com', 'https://q.us-east-1.amazonaws.com'].includes(url.origin)) throw new Error('Unexpected Kiro fixture origin');
  const body = JSON.parse(String(init?.body));
  appendFileSync(join(process.env.AXIOM_KIRO_FIXTURE_DIR, 'requests.jsonl'), JSON.stringify({ path: url.pathname, worker: process.env.AXIOM_MODEL_NETWORK_WORKER }) + '\n');
  let response;
  if (url.origin === 'https://q.us-east-1.amazonaws.com') {
    const headers = new Headers(init.headers);
    if (init.method !== 'POST' || init.redirect !== 'error' || url.pathname !== '/' ||
        url.searchParams.get('origin') !== 'KIRO_CLI' || body.origin !== 'KIRO_CLI' ||
        headers.get('x-amz-target') !== 'AmazonCodeWhispererService.ListAvailableModels' ||
        headers.get('Authorization') !== 'Bearer FIXTURE-ACCESS') throw new Error('Unexpected catalog protocol');
    const model = { modelId: 'fixture-kiro-model', modelName: 'Fixture Kiro Model', supportedInputTypes: ['TEXT', 'IMAGE'], tokenLimits: { maxInputTokens: 123456, maxOutputTokens: 8192 } };
    response = { models: [model], defaultModel: model };
  }
  else if (url.pathname === '/client/register') response = { clientId: 'FIXTURE-CLIENT', clientSecret: 'FIXTURE-CLIENT-SECRET', clientSecretExpiresAt: Math.floor(Date.now() / 1000) + 86400 };
  else if (url.pathname === '/device_authorization') response = { deviceCode: 'FIXTURE-DEVICE', userCode: 'ABCD', verificationUri: 'https://device.sso.us-east-1.amazonaws.com/', expiresIn: 600, interval: 1 };
  else if (url.pathname === '/token' && body.deviceCode === 'FIXTURE-DEVICE') response = { accessToken: 'FIXTURE-ACCESS', refreshToken: 'FIXTURE-REFRESH', expiresIn: 3600 };
  else throw new Error('Unexpected Kiro fixture request');
  return new Response(JSON.stringify(response), { headers: { 'Content-Type': 'application/json' } });
};
Object.defineProperty(globalThis, 'fetch', { configurable: true, get: () => mock, set() {} });
