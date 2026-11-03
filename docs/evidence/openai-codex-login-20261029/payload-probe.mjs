import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { stream as openaiStream } from '/Volumes/D_Work/axiom2/app/node_modules/@earendil-works/pi-ai/dist/api/openai-responses.js';
import { stream as codexStream } from '/Volumes/D_Work/axiom2/app/node_modules/@earendil-works/pi-ai/dist/api/openai-codex-responses.js';
import { OPENAI_MODELS } from '/Volumes/D_Work/axiom2/app/node_modules/@earendil-works/pi-ai/dist/providers/openai.models.js';
import { OPENAI_CODEX_MODELS } from '/Volumes/D_Work/axiom2/app/node_modules/@earendil-works/pi-ai/dist/providers/openai-codex.models.js';
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw new Error('FIXTURE_NETWORK_FORBIDDEN'); };
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const fakeCodexToken = `${b64({alg:'none'})}.${b64({'https://api.openai.com/auth':{chatgpt_account_id:'fixture-account'}})}.fixture`;
const context = { messages: [
  { role: 'system', content: 'Fixture system instruction.', timestamp: 0,
    toolsAdded: [{ name: 'fixture_tool', description: 'No operation', parameters: {type:'object',properties:{}} }] },
  { role: 'user', content: [{type:'text',text:'Fixture question.'}], timestamp: 1 }
] };
const find = (catalog, id) => Object.values(catalog).find(m => m.id === id);
const common = { maxTokens: 1234, temperature: 0.2, cacheRetention:'long', sessionId:'fixture-session',
  reasoningEffort:'high', serviceTier:'priority' };
const results = [];
for (const [label, fn, model, apiKey] of [
  ['openai_chatgpt_direct',openaiStream,find(OPENAI_MODELS,'gpt-5.5'),'fixture-direct-opaque'],
  ['codex_oauth',codexStream,find(OPENAI_CODEX_MODELS,'gpt-5.5'),fakeCodexToken],
  ['openai_api_key_control',openaiStream,find(OPENAI_MODELS,'gpt-5.5'),'sk-fixture-not-a-real-key']
]) {
  assert.ok(model);
  let payload;
  const result = await fn(model, context, { ...common, apiKey, onPayload(body) {
    payload = body;
    throw new Error('FIXTURE_STOP_BEFORE_NETWORK');
  }}).result();
  assert.ok(payload, `${label}: payload intercepted`);
  assert.match(result.errorMessage ?? '', /FIXTURE_STOP_BEFORE_NETWORK/);
  results.push({label,payload});
}
const direct = results[0].payload, codex = results[1].payload, control = results[2].payload;
assert.equal(direct.max_output_tokens,undefined);
assert.equal(direct.temperature,undefined);
assert.equal(direct.prompt_cache_retention,undefined);
assert.equal(control.max_output_tokens,1234);
assert.equal(control.temperature,0.2);
assert.equal(control.prompt_cache_retention,'24h');
assert.equal(codex.max_output_tokens,undefined);
assert.equal(codex.temperature,0.2);
assert.equal(codex.instructions,'Fixture system instruction.');
assert.equal(codex.parallel_tool_calls,true);
for (const {payload} of results) {
  assert.equal(payload.store,false);
  assert.equal(payload.model,'gpt-5.5');
  assert.equal(payload.stream,true);
  assert.equal(payload.service_tier,'priority');
  assert.ok(payload.tools?.some(tool => tool.name === 'fixture_tool'));
}
assert.equal(networkCalls,0);
const report = {status:'passed',networkCalls,scope:'Local request construction only. All identities, keys and prompts are fixtures. Every stream is deliberately stopped in onPayload before any request.',results};
writeFileSync('/tmp/axiom-openai-codex-research/local/payload-probe.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,networkCalls,cases:results.map(r=>r.label)}));
