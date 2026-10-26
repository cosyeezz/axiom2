import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import WebSocket from 'file:///F:/Axiom/axiom2/app/node_modules/ws/wrapper.mjs';
const endpoint = 'ws://127.0.0.1:4317/ws';
const runs = ['b483c133-fe77-46bf-bd7d-bb1111de2039'];
const report = { schemaVersion: 1, purpose: 'Read an existing in-memory metadata ring, filtered to an already public historical run. No task mutation or model request.', operation: 'diagnostics.latency', attemptsPerQuery: 1, modelRequestsSent: 0, queries: [] };
const pending = new Map();
const ws = new WebSocket(endpoint, { headers: { Origin: 'http://127.0.0.1:4317' } });
ws.on('message', bytes => {
  let receipt; try { receipt = JSON.parse(bytes.toString('utf8')); } catch { return; }
  const p = pending.get(receipt.requestId); if (!p || receipt.type !== 'receipt') return;
  pending.delete(receipt.requestId); clearTimeout(p.timer); p.resolve(receipt);
});
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('LOCAL_SOCKET_OPEN_TIMEOUT')), 3000);
    ws.once('open', () => { clearTimeout(timeout); resolve(); });
    ws.once('error', error => { clearTimeout(timeout); reject(Error(error.code ?? 'LOCAL_SOCKET_ERROR')); });
  });
  for (const runId of runs) {
    const requestId = 'krs-readonly-' + randomUUID();
    const receipt = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(Error('LOCAL_METADATA_RECEIPT_TIMEOUT')); }, 3000);
      pending.set(requestId, { resolve, timer });
      ws.send(JSON.stringify({ requestId, op: 'diagnostics.latency', params: { runId } }));
    });
    assert.equal(receipt.ok, true); assert.ok(Array.isArray(receipt.data.records));
    const records = receipt.data.records;
    assert.ok(records.every(r => r.runId === runId));
    const stages = Object.fromEntries([...new Set(records.map(r => r.stage))].map(stage => [stage, records.filter(r => r.stage === stage).length]));
    report.queries.push({ runId, ok: true, ringCapacity: receipt.data.capacity, matchingRecords: records.length, stages, recordedHttpStatuses: records.filter(r => Number.isFinite(r.status)).map(r => ({ stage: r.stage, status: r.status, at: r.at })), distinctRequestIds: new Set(records.map(r => r.requestId).filter(Boolean)).size, coverage: records.length ? 'Only retained ring records; completeness is not guaranteed.' : 'No retained records. This does not mean the model made no requests.', errorBodyOrRetryAfterAvailableFromThisEndpoint: false });
  }
  report.readOnlyQueryCompleted = true;
} catch (error) {
  report.readOnlyQueryCompleted = false;
  report.blocker = { name: error?.name ?? 'Error', code: error?.code ?? null, safeMessage: ['LOCAL_SOCKET_OPEN_TIMEOUT', 'ECONNREFUSED', 'ECONNRESET', 'LOCAL_SOCKET_ERROR', 'LOCAL_METADATA_RECEIPT_TIMEOUT'].includes(error?.message) ? error.message : 'LOCAL_METADATA_QUERY_FAILED' };
  process.exitCode = 1;
} finally {
  for (const p of pending.values()) clearTimeout(p.timer);
  ws.terminate();
  await writeFile(new URL('latency-readonly-v1.json', import.meta.url), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ readOnlyQueryCompleted: report.readOnlyQueryCompleted, queries: report.queries.length, retainedRecords: report.queries.reduce((n, r) => n + r.matchingRecords, 0), modelRequestsSent: 0 }));
}
