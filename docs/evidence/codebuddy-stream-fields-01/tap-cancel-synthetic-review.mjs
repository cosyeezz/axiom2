import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { responseProjection } = require('../codebuddy-cli-compare-01/PROJECTION.cjs');
const results = { node: process.version, scope: 'synthetic Web Streams only; no SDK, auth, HTTP, live runner or production imports', cases: [], projection: [] };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };
async function testTap(mode, scenario) {
  const trace = [], pending = deferred(), sourceCancel = deferred(), observedCancel = deferred();
  let source, readStarted = false;
  const underlying = new ReadableStream({
    start(c) { source = c; },
    pull() { if (!readStarted) { readStarted = true; pending.resolve(); } },
    async cancel() { trace.push('source-cancel-start'); observedCancel.resolve(); await sourceCancel.promise; trace.push('source-cancel-end'); }
  }, {highWaterMark: 0});
  const reader = underlying.getReader();
  let finished = false, exit, cancellation = false, activeBodies = 1, bytes = 0;
  const finish = reason => { if (finished) return; finished = true; exit = reason; activeBodies--; trace.push(`finish:${reason}`); };
  // Same lifecycle ordering as AXIOM-RUN tap; byte projection intentionally omitted.
  // "intent-first" is an isolated proposal, NOT production code under test.
  const tap = new ReadableStream({
    async pull(out) {
      try {
        const part = await reader.read(); trace.push(part.done ? 'read:done' : 'read:chunk');
        if (mode === 'intent-first' && cancellation) return;
        if (part.done) { reader.releaseLock(); finish('eof'); out.close(); return; }
        bytes += part.value.length; out.enqueue(part.value);
      } catch (error) {
        trace.push('pull-catch');
        if (mode === 'intent-first') { if (cancellation) return; finish('error'); }
        await reader.cancel().catch(() => {}); finish('error'); out.error(error);
      }
    },
    async cancel() {
      trace.push('tap-cancel-start');
      if (mode === 'intent-first') { cancellation = true; finish('consumer-cancel'); }
      await reader.cancel().catch(() => {}); finish('consumer-cancel'); trace.push('tap-cancel-end');
    }
  }, {highWaterMark: 0});
  const consumer = tap.getReader();
  if (scenario === 'concurrent-pull-cancel') {
    const read = consumer.read(); await pending.promise;
    const cancel = consumer.cancel('synthetic-consumer'); await observedCancel.promise;
    await new Promise(setImmediate); sourceCancel.resolve(); await Promise.all([read, cancel]);
  } else if (scenario === 'DONE-then-SDK-abort-simulation') {
    const abort = new AbortController();
    const doneChunk = new TextEncoder().encode('data: [DONE]\n\n');
    source.enqueue(doneChunk); const first = await consumer.read(); assert.deepEqual(first.value, doneChunk);
    const read = consumer.read(); await pending.promise;
    let cancel;
    abort.signal.addEventListener('abort', () => { trace.push('simulated-sdk-abort'); cancel = consumer.cancel(); }, {once:true});
    abort.abort(); await observedCancel.promise; await new Promise(setImmediate); sourceCancel.resolve(); await Promise.all([read, cancel]);
  } else if (scenario === 'true-error') {
    const read = consumer.read(); await pending.promise; source.error(new Error('SYNTHETIC')); await assert.rejects(read, /SYNTHETIC/);
  } else {
    const read = consumer.read(); await pending.promise; source.close(); assert.equal((await read).done, true);
  }
  await new Promise(setImmediate);
  const expected = scenario === 'true-error' ? 'error' : scenario === 'true-EOF' || mode === 'original' ? 'eof' : 'consumer-cancel';
  assert.equal(exit, expected); assert.equal(activeBodies, 0);
  results.cases.push({mode, scenario, exit, bytes, activeBodies, trace, passed:true});
}
for (const mode of ['original','intent-first']) for (const scenario of ['concurrent-pull-cancel','DONE-then-SDK-abort-simulation','true-error','true-EOF']) await testTap(mode, scenario);
// Synthetic projection test uses only the inert original PROJECTION.cjs module.
for (const [kind, value] of [['missing',undefined],['null',null],['empty-string',''],['stop','stop'],['unknown-string','synthetic-unknown'],['number',0],['boolean',false],['array',[]],['object',{}]]) {
  const choice = {index:0, delta:{role:'assistant',content:'AXIOM_CODEBUDDY_COMPARE_01'}};
  if (kind !== 'missing') choice.finish_reason = value;
  const bytes = Buffer.from(`data: ${JSON.stringify({choices:[choice]})}\n\ndata: [DONE]\n\n`);
  const projected = responseProjection(bytes, {'content-type':'text/event-stream'});
  const finish = projected.frames[0].choices[0].finish;
  assert.equal(finish, kind === 'missing' || kind === 'null' ? null : kind === 'stop' ? 'stop' : 'other');
  assert.equal(projected.strictTerminal, kind === 'stop');
  results.projection.push({syntheticInputKind:kind, oldFinish:finish, strictTerminal:projected.strictTerminal});
}
results.passed = true;
const output = new URL('./tap-cancel-synthetic-results.json', import.meta.url);
writeFileSync(output, JSON.stringify(results,null,2)+'\n', {flag:'wx',mode:0o600});
console.log(JSON.stringify({passed:true, tapCases:results.cases.length, projectionCases:results.projection.length, output:output.pathname}));
