// No upstream access: replay only the pre-failure historical messages through a synthetic sender.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createModels } from '../../app/node_modules/@earendil-works/pi-ai/dist/index.js';
import { codeBuddyProvider } from '../../app/dist/server/providers/codebuddy-cn.js';
import { buildSessionContext } from '../../app/node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js';
import { convertToLlm } from '../../app/node_modules/@earendil-works/pi-coding-agent/dist/core/messages.js';
const report = { upstreamRequests: 0, syntheticRequests: 0, passed: false };
let provider, gate = 'locate-session';
try {
  const db = new DatabaseSync('/Users/dane/Library/Application Support/Axiom2/axiom.sqlite', { readOnly: true });
  let file; try { file = db.prepare('SELECT file FROM agent_sessions WHERE sessionId=?').get('bfd10fe6-8385-44f2-a35b-6baa8984fdbd')?.file; } finally { db.close(); }
  assert.ok(file);
  const entries = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  gate = 'locate-failure';
  const failedEntry = entries.find(e => e.type === 'message' && e.message.role === 'assistant' && e.message.provider === 'codebuddy-cn' && e.message.timestamp >= 1793957590746 && e.message.errorMessage === 'CodeBuddy 请求参数或上下文无效；未发送请求。');
  assert.ok(failedEntry?.parentId);
  gate = 'history-count'; const messages = convertToLlm(buildSessionContext(entries.filter(e => e.type !== 'session'), failedEntry.parentId).messages);
  const original = structuredClone(messages); report.preFailureMessages = messages.length;
  assert.ok(messages.length > 0);
  const assistants = messages.filter(m => m.role === 'assistant'), blocks = assistants.flatMap(m => m.content || []);
  const signatures = blocks.filter(b => b.type === 'thinking' && b.thinkingSignature !== undefined).map(b => b.thinkingSignature);
  const compositeIds = blocks.filter(b => b.type === 'toolCall' && b.id.includes('|')).map(b => b.id);
  Object.assign(report, { messages: messages.length, assistants: assistants.length, signedThinking: signatures.length, compositeToolIds: compositeIds.length,
    redactedThinking: blocks.filter(b => b.type === 'thinking' && b.redacted).length,
    namespacedTools: blocks.filter(b => b.type === 'toolCall' && b.namespace !== undefined).length,
    argumentErrors: blocks.filter(b => b.type === 'toolCall' && b.argumentsError !== undefined).length,
    systemMessages: messages.filter(m => m.role === 'system').length,
    otherRoleMessages: messages.filter(m => !['system', 'user', 'assistant', 'toolResult'].includes(m.role)).length });
  assert.ok(signatures.length > 0); assert.ok(compositeIds.length > 0);
  gate = 'native-projection'; const runtime = createModels(); provider = codeBuddyProvider(); runtime.setProvider(provider);
  const model = provider.getModels().find(m => m.id === 'deepseek-v4.1-flash'); assert.ok(model);
  const stream = runtime.streamSimple(model, { messages }, {
    apiKey: 'SYNTHETIC_NO_NETWORK_TOKEN', reasoning: 'high', maxRetries: 0,
    fetch: async (_url, init) => { report.syntheticRequests++; const body = JSON.parse(init.body);
      const strings = []; function walk(v) { if (typeof v === 'string') strings.push(v); else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x); } walk(body);
      for (const signature of signatures) if (signature) assert.ok(!strings.some(s => s.includes(signature)));
      const calls = body.messages.flatMap(m => m.tool_calls || []), results = body.messages.filter(m => m.role === 'tool');
      for (const id of compositeIds) { assert.equal(calls.filter(c => c.id === id).length, 1); assert.equal(results.filter(r => r.tool_call_id === id).length, 1); }
      assert.equal(body.reasoning_effort, 'high'); report.opaqueSignaturesAbsent = true; report.originalCompositePairsPreserved = true;
      return new Response('data: {"choices":[{"index":0,"delta":{"content":"SYNTHETIC_ACCEPTED"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  for await (const _ of stream) { /* intentionally no context/event logging */ }
  const result = await stream.result(); report.stopReason = result.stopReason;
  report.failureCodes = (result.diagnostics || []).filter(d => d.type === 'codebuddy-failure').map(d => d.details?.protocolCode).filter(v => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,48}$/.test(v));
  assert.equal(result.stopReason, 'stop'); assert.equal(report.syntheticRequests, 1);
  assert.deepEqual(messages, original); report.sourceUnchanged = true; report.passed = true;
} catch { report.category = 'offline-history-validation-failed'; report.gate = gate; process.exitCode = 1; }
finally { provider?.dispose(); writeFileSync(resolve('artifacts/codebuddy-cross-model-20261106-01/offline-history-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); }
