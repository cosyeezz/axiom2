// One-shot real native SDK generation. No tools execute and no defaults/session state are mutated.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createModelRuntime, invalidModelDefinition } from '../../app/dist/server/model-runtime.js';
import { ModelService } from '../../app/dist/server/model-service.js';
import { executionModelsRaw } from '../../app/dist/server/execution-model-config.js';
const out = resolve('artifacts/codebuddy-cross-model-20261106-01'); mkdirSync(out, { recursive: true });
const reportPath = join(out, 'native-live-03-report.json');
assert.ok(!existsSync(reportPath), 'existing-live-report-do-not-rerun');
const report = { case: '03-native-foreign-history', model: 'deepseek-v4.1-flash', thinking: 'high', passed: false, payloadCallbacks: 0, responseCount: 0, textDeltas: 0, emittedToolCalls: 0, sourceHistorySynthetic: true, formalUi: false, settingsMutated: false, toolsExecuted: 0 };
let runtime, snapshotDir, gate = 'runtime-proof', started;
try {
  const proof = JSON.parse(readFileSync(join(out, 'runtime-proof.json')));
  assert.equal(proof.restart.http, 200); assert.equal(proof.restart.websocket, 'connected');
  for (const m of proof.modules) assert.equal(createHash('sha256').update(readFileSync(m.path)).digest('hex'), m.sha256);
  gate = 'selected-definition'; const service = new ModelService('/Users/dane/Library/Application Support/Axiom2'), dir = service.dir;
  // Match the production worker: snapshot only the selected provider, never gate
  // request admission on unrelated advisory availability/catalog diagnostics.
  snapshotDir = await mkdtemp(join(tmpdir(), 'axiom-cb-live-model-profile-'));
  const modelsPath = join(snapshotDir, 'models.json');
  await writeFile(modelsPath, executionModelsRaw(await service.raw(), 'codebuddy-cn'), { flag: 'wx', mode: 0o600 });
  assert.equal(await invalidModelDefinition(modelsPath, 'codebuddy-cn'), false);
  gate = 'sdk-initialize';
  runtime = await createModelRuntime({ providerIds: ['codebuddy-cn'], providerScope: 'codebuddy-cn', authPath: join(dir, 'auth.json'), modelsPath, modelsStorePath: join(dir, 'models-store.json'), allowModelNetwork: false, signal: AbortSignal.timeout(10000) });
  report.advisoryAvailabilityWarning = Boolean(runtime.getError()?.startsWith('Availability refresh:'));
  const model = runtime.getModel('codebuddy-cn', 'deepseek-v4.1-flash'); assert.ok(model);
  const fixture = join(out, 'native-03-synthetic.txt'); writeFileSync(fixture, 'fixture-value=58\n', { flag: 'wx' });
  const history = [
    { role: 'user', content: '记住代号雪松-7641和数字246，并读取合成测试fixture。', timestamp: 1 },
    { role: 'assistant', api: 'openai-responses', provider: 'openai', model: 'synthetic-source', timestamp: 2, stopReason: 'toolUse',
      content: [{ type: 'thinking', thinking: 'I will preserve the synthetic marker and number while reading the fixture.', thinkingSignature: 'EXPLICITLY_SYNTHETIC_OPAQUE_SIGNATURE' }, { type: 'toolCall', id: 'call_synthetic|fc_synthetic', name: 'read', arguments: { path: fixture } }],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } },
    { role: 'toolResult', toolCallId: 'call_synthetic|fc_synthetic', toolName: 'read', content: [{ type: 'text', text: readFileSync(fixture, 'utf8') }], isError: false, timestamp: 3 },
    { role: 'assistant', api: 'openai-responses', provider: 'openai', model: 'synthetic-source', timestamp: 4, stopReason: 'stop', content: [{ type: 'text', text: '已记住代号和数字，合成fixture已读取。' }], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } },
    { role: 'user', content: '不要调用工具。回忆历史代号与原数字，算原数字加31，并回忆fixture键值。只给这四项结果。', timestamp: 5 },
  ];
  const before = structuredClone(history);
  gate = 'one-shot-admission'; writeFileSync(join(out, '03-native-foreign-history.claim'), 'exclusive prompt admission\n', { flag: 'wx' });
  started = Date.now(); const signal = AbortSignal.timeout(90000); gate = 'native-stream';
  const stream = runtime.streamSimple(model, { systemPrompt: 'This is a bounded synthetic-history continuation check. Preserve the supplied history; do not call tools, access files, or use the network yourself. Answer only the requested recall and arithmetic.', messages: history }, {
    reasoning: 'high', maxTokens: 1024, maxRetries: 0, signal, timeoutMs: 90000,
    onPayload: payload => { report.payloadCallbacks++; assert.equal(report.payloadCallbacks, 1); assert.equal(payload.reasoning_effort, 'high');
      const assistant = payload.messages.find(m => m.tool_calls?.length); assert.equal(assistant.tool_calls[0].id, 'call_synthetic|fc_synthetic');
      assert.equal(assistant.reasoning_content, history[1].content[0].thinking);
      assert.ok(payload.messages.some(m => m.role === 'assistant' && m.content === history[3].content[0].text));
      assert.ok(payload.messages.some(m => m.role === 'tool' && m.tool_call_id === 'call_synthetic|fc_synthetic' && m.content === history[2].content[0].text));
      assert.ok(!payload.tools?.length); report.readableHistoryPreserved = true;
      assert.ok(!JSON.stringify(payload).includes('EXPLICITLY_SYNTHETIC_OPAQUE_SIGNATURE')); report.opaqueSignatureAbsent = true; report.compositePairPreserved = true;
    },
    onResponse: response => { report.responseCount++; report.httpStatus = response.status; },
  });
  for await (const event of stream) { if (event.type === 'text_delta') report.textDeltas++; if (event.type === 'toolcall_end') report.emittedToolCalls++; }
  const result = await stream.result(); report.stopReason = result.stopReason; report.thinkingChars = result.content.filter(b => b.type === 'thinking').reduce((n, b) => n + (b.thinking?.length || 0), 0);
  report.failureCodes = (result.diagnostics || []).filter(d => d.type === 'codebuddy-failure').map(d => d.details?.protocolCode).filter(v => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,48}$/.test(v));
  const text = result.content.filter(b => b.type === 'text').map(b => b.text).join('');
  assert.equal(result.stopReason, 'stop'); assert.equal(report.payloadCallbacks, 1); assert.equal(report.responseCount, 1); assert.ok(report.httpStatus >= 200 && report.httpStatus < 300); assert.ok(report.textDeltas > 0); assert.equal(report.emittedToolCalls, 0);
  assert.match(text, /雪松.?7641/); assert.match(text, /246/); assert.match(text, /277/); assert.match(text, /58/);
  assert.deepEqual(history, before); report.correctRecallAndArithmetic = true; report.sourceUnchanged = true; report.passed = true;
} catch { report.category = 'bounded-native-history-check-failed'; report.gate = gate; process.exitCode = 1; }
finally { report.ms = started ? Date.now() - started : 0; runtime?.getRegisteredNativeProvider('codebuddy-cn')?.dispose?.();
  if (snapshotDir) { try { await rm(snapshotDir, { recursive: true, force: true }); report.temporaryProfileRemoved = true; } catch { report.temporaryProfileRemoved = false; process.exitCode = 1; } }
  writeFileSync(reportPath, JSON.stringify(report, null, 2), { flag: 'wx' }); console.log(JSON.stringify(report)); }
