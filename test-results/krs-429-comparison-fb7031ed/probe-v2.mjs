import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Socket } from 'node:net';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = 'F:/Axiom/axiom-kiro-long-session-fb7031ed/app/';
const url = path => pathToFileURL(root + path).href;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const output = new URL('probe-v2.json', import.meta.url);
const statePath = 'F:/Axiom/axiom2/test-results/kiro-long-session/sonnet-post429-v4/state.json';
const sourcePaths = ['src/server/providers/kiro-chat.ts', 'src/server/providers/kiro-chat-protocol.ts', 'src/server/model-latency.ts', 'node_modules/@earendil-works/pi-ai/dist/utils/retry.js'];
const originalFetch = globalThis.fetch, originalConnect = Socket.prototype.connect;
let networkAttempts = 0, socketAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw Error('NETWORK_FORBIDDEN'); };
Socket.prototype.connect = function () { socketAttempts++; throw Error('SOCKET_FORBIDDEN'); };
const report = { schemaVersion: 1, scope: 'offline synthetic adapter and SDK-helper observations, not live AXIOM worker or Kiro acceptance', releaseCommit: process.env.KRS_RELEASE_COMMIT, scenarios: [] };
try {
  assert.match(report.releaseCommit ?? '', /^[a-f0-9]{40}$/);
  const hashes = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async p => [p, hash(await readFile(root + p))])));
  const before = await hashes(), stateBefore = hash(await readFile(statePath));
  const [{ kiroChat }, { normalizeContext }, { kiroFrame, kiroResponse }, { isRetryableAssistantError, retryAssistantCall }] = await Promise.all([
    import(url('src/server/providers/kiro-chat.ts')),
    import(url('node_modules/@earendil-works/pi-ai/dist/index.js')),
    import(url('tests/fixtures/kiro-eventstream.ts')),
    import(url('node_modules/@earendil-works/pi-ai/dist/utils/retry.js')),
  ]);
  const target = { id: 'synthetic-selected-model', name: 'Synthetic', provider: 'kiro', api: 'kiro-chat', baseUrl: 'https://q.us-east-1.amazonaws.com', input: ['text'], reasoning: false, contextWindow: 100000, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const context = normalizeContext({ systemPrompt: 'Synthetic probe only.', messages: [{ role: 'user', content: 'Synthetic input.', timestamp: 1 }] });
  const cases = [
    { name: 'http-success', status: 200, success: true },
    { name: 'http429-user-rate', status: 429, reason: 'USER_REQUEST_RATE_EXCEEDED', after: '120' },
    { name: 'http429-credit-rate', status: 429, reason: 'CREDIT_CONSUMPTION_RATE_EXCEEDED', after: '1800' },
    { name: 'http429-monthly', status: 429, reason: 'MONTHLY_REQUEST_COUNT', after: '600' },
    { name: 'http402-monthly', status: 402, reason: 'MONTHLY_REQUEST_COUNT' },
    { name: 'http200-stream-throttle', status: 200, code: 'ThrottlingException', reason: 'USER_REQUEST_RATE_EXCEEDED' },
    { name: 'http200-stream-quota', status: 200, code: 'ServiceQuotaExceededException', reason: 'MONTHLY_REQUEST_COUNT' },
    { name: 'partial-then-throttle', status: 200, code: 'ThrottlingException', reason: 'USER_REQUEST_RATE_EXCEEDED', partial: true },
  ];
  let totalStubCalls = 0;
  const invocationIds = new Set(), conversations = new Set();
  async function invoke(c) {
    let calls = 0, bodyMethods = 0, observed;
    const started = performance.now();
    const adapter = kiroChat({}, async (_input, init) => {
      calls++; totalStubCalls++;
      const headers = new Headers(init.headers), payload = JSON.parse(init.body);
      assert.equal(headers.get('authorization'), 'Bearer synthetic-access-not-real');
      assert.equal(headers.get('amz-sdk-request'), 'attempt=1; max=1');
      assert.equal(headers.get('user-agent'), 'Axiom KiroChat/1.0');
      invocationIds.add(headers.get('amz-sdk-invocation-id'));
      conversations.add(payload.conversationState.conversationId);
      let response;
      if (c.code) {
        const frames = c.partial ? [kiroFrame('assistantResponseEvent', { content: 'synthetic partial text' })] : [];
        frames.push(kiroFrame(c.code, { reason: c.reason }, { ':message-type': 'exception', ':exception-type': c.code }));
        response = kiroResponse(frames);
      } else if (c.success) response = kiroResponse([kiroFrame('assistantResponseEvent', { content: 'synthetic success' })]);
      else response = new Response(JSON.stringify({ __type: 'ThrottlingException', reason: c.reason }), { status: c.status, headers: { 'content-type': 'application/json', ...(c.after ? { 'retry-after': c.after } : {}) } });
      for (const key of ['text', 'json']) {
        const original = response[key].bind(response);
        response[key] = (...args) => { bodyMethods++; return original(...args); };
      }
      return response;
    });
    const { apiKey } = await adapter.auth.toAuth({ type: 'oauth', access: 'synthetic-access-not-real', refresh: 'synthetic-refresh-not-real', expires: Date.now() + 3600000, authMethod: 'builder-id', authRegion: 'us-east-1' });
    const stream = adapter.stream(target, context, { apiKey, sessionId: 'synthetic-fixed-session', onResponse: r => { observed = { status: r.status, retryAfter: r.headers['retry-after'] ?? null }; } });
    for await (const _ of stream) { /* Consume synthetic stream only. */ }
    const message = await stream.result();
    assert.equal(calls, 1);
    assert.equal(observed.status, c.status);
    assert.equal(observed.retryAfter, c.after ?? null);
    assert.equal(bodyMethods, 0);
    assert.equal(message.stopReason, c.success ? 'stop' : 'error');
    const retryable = isRetryableAssistantError(message);
    assert.equal(retryable, !c.success && c.status !== 402);
    const textCharacters = message.content.filter(p => p.type === 'text').reduce((n, p) => n + p.text.length, 0);
    if (c.partial) assert.ok(textCharacters > 0 && retryable);
    return { message, observation: { name: c.name, httpStatus: observed.status, syntheticBodyReason: c.reason ?? null, streamExceptionCode: c.code ?? null, responseRetryAfter: observed.retryAfter, stubCalls: calls, bodyParseMethodCalls: bodyMethods, stopReason: message.stopReason, sdkClassifierRetryable: retryable, errorMessageSha256: message.errorMessage ? hash(message.errorMessage) : null, textCharacters, elapsedMs: Math.round((performance.now() - started) * 1000) / 1000 } };
  }
  for (const c of cases) report.scenarios.push((await invoke(c)).observation);
  const ambiguous = report.scenarios.filter(c => /http429-|http200-stream-|partial-/.test(c.name));
  assert.equal(new Set(ambiguous.map(c => c.errorMessageSha256)).size, 1);
  let helperCalls = 0;
  const scheduled = [];
  const final = await retryAssistantCall(async () => { helperCalls++; return (await invoke(cases[3])).message; }, { enabled: true, maxRetries: 3, baseDelayMs: 0, maxAgentDelayMs: 0 }, undefined, { onRetryScheduled: (attempt, maximum, delay) => { scheduled.push({ attempt, maximum, delay }); } });
  assert.equal(helperCalls, 4); assert.equal(scheduled.length, 3); assert.equal(final.stopReason, 'error');
  report.scenarios.push({ name: 'sdk-helper-monthly-normalized-error', syntheticOnly: true, localZeroDelayPolicyNotGlobalConfiguration: true, helperInvocations: helperCalls, scheduled, stopReason: final.stopReason });
  const state = JSON.parse(await readFile(statePath, 'utf8')), turn = state.turns[0];
  const waits = new Map();
  for (const e of turn.events) if (e.retry?.state === 'waiting') waits.set(e.retry.attempt, Math.max(waits.get(e.retry.attempt) ?? -Infinity, e.retry.nextRetryAt - e.at));
  report.existingRunObservation = { sourceStateSha256: stateBefore, durableInputs: state.turns.length, runId: turn.run.id, runStatus: turn.run.status, retry: { attempt: turn.run.retry.attempt, maxAttempts: turn.run.retry.maxAttempts, state: turn.run.retry.state }, largestObservedRemainingWaitMs: [...waits].map(([attempt, milliseconds]) => ({ attempt, milliseconds })), httpStatusOrErrorBodyNotCapturedInThisState: true, limitation: 'These progress records alone do not count HTTP attempts or distinguish an HTTP429 from a stream exception normalized to the same text.' };
  assert.equal(stateBefore, hash(await readFile(statePath)));
  const after = await hashes(); assert.deepEqual(after, before);
  assert.equal(networkAttempts, 0); assert.equal(socketAttempts, 0);
  assert.equal(invocationIds.size, totalStubCalls); assert.equal(conversations.size, 1);
  Object.assign(report, { passed: true, assertionsCompleted: true, sourceSha256: before, sourceUnchanged: true, originalStateUnchanged: true, scenariosPassed: report.scenarios.length, totalSyntheticStubCalls: totalStubCalls, realNetworkAttempts: networkAttempts, socketConnectAttempts: socketAttempts, stableSyntheticConversation: true, newInvocationPerAdapterCall: true, identical429AndStreamErrorMessages: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ passed: true, scenarios: report.scenarios.length, syntheticStubCalls: totalStubCalls, realNetworkAttempts: networkAttempts, socketConnectAttempts: socketAttempts, output: fileURLToPath(output) }));
} catch (error) {
  report.passed = false; report.failure = { name: error?.name ?? 'Error', code: error?.code ?? null, message: String(error?.message ?? error).slice(0, 1200) };
  await writeFile(new URL('probe-failure-v2.json', import.meta.url), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.error(JSON.stringify(report.failure)); process.exitCode = 1;
} finally { globalThis.fetch = originalFetch; Socket.prototype.connect = originalConnect; }
