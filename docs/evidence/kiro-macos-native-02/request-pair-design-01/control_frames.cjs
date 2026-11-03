'use strict';
// Fixed non-raw control frames for a FUTURE private IPC multiplexer. No IO.
// A snapshot is instantaneous observer state, never process/owner termination.
const { Buffer } = require('node:buffer');
const { ownValue, copyChunk } = require('./traffic_values.cjs');
const STATUS_MAGIC = 0x4b505331, FAULT_MAGIC = 0x4b504631;
const STATES = ['not-installed', 'active', 'closed', 'conflict'];
const SOURCES = [null, 'node-http', 'undici'];
const SCHEMAS = [null, 'node-http-ram-adapter-1', 'undici-ram-adapter-1'];
const COVERAGE = [null, 'partial-end-api-only', 'diagnostic-values-only'];
const FAULTS = new Set(['none', 'late-call', 'call-cap', 'unsupported-receiver', 'record-cap',
  'reentrant-request', 'write-after-end', 'repeated-end', 'original-threw', 'unsupported-header',
  'unsupported-candidate-body', 'candidate-cap', 'aggregate-cap', 'sink-threw', 'observer-fault',
  'restore-conflict', 'close-pending', 'install-refused', 'install-failed', 'late-event',
  'unsupported-message', 'repeated-headers', 'request-error', 'late-request-event', 'chunk-cap',
  'unsupported-or-oversized-chunk', 'unsupported-utf8', 'unsubscribe-conflict', 'incomplete-candidate']);
const COUNTS = [['calls', 128], ['pending', 128], ['records', 16], ['candidates', 4], ['submitted', 4]];
function sourceCode(source) { return source === 'node-http' ? 1 : source === 'undici' ? 2 : 0; }
function validCounts(values) {
  return values.every((value, i) => Number.isInteger(value) && value >= 0 && value <= COUNTS[i][1])
    && values[1] <= values[0] && values[3] <= values[2] && values[4] <= values[3];
}
function encodeStatus(source, snapshot) {
  try {
    const code = sourceCode(source);
    if (!code || ownValue(snapshot, 'schema') !== SCHEMAS[code]
        || ownValue(snapshot, 'coverage') !== COVERAGE[code]
        || ownValue(snapshot, 'naturalInstallationProved') !== false
        || ownValue(snapshot, 'requestCompletenessProved') !== false
        || ownValue(snapshot, 'wireReceiptProved') !== false) return null;
    const state = STATES.indexOf(ownValue(snapshot, 'state')), fault = ownValue(snapshot, 'fault');
    const values = COUNTS.map(([name]) => ownValue(snapshot, name));
    if (state < 0 || !FAULTS.has(fault) || !validCounts(values)) return null;
    const frame = Buffer.alloc(16);
    frame.writeUInt32BE(STATUS_MAGIC, 0); frame[4] = code; frame[5] = state; frame[6] = fault === 'none' ? 0 : 1;
    frame.writeUInt16BE(values[0], 8); frame.writeUInt16BE(values[1], 10);
    frame[12] = values[2]; frame[13] = values[3]; frame[14] = values[4];
    return frame;
  } catch (_) { return null; }
}
function encodeFault(source) {
  const code = sourceCode(source);
  if (!code) return null;
  const frame = Buffer.alloc(8);
  frame.writeUInt32BE(FAULT_MAGIC, 0); frame[4] = code; frame[5] = 1;
  return frame;
}
function decode(input) {
  try {
    if (typeof input === 'string') return null;
    const frame = copyChunk(input, 16);
    if (!frame || frame.length !== 8 && frame.length !== 16) return null;
    const magic = frame.readUInt32BE(0), source = SOURCES[frame[4]];
    if (!source) return null;
    if (magic === FAULT_MAGIC) {
      if (frame.length !== 8 || frame[5] !== 1 || frame[6] || frame[7]) return null;
      return { schema: 'observer-fault-frame-1', source, faultPresent: true,
        ownerTerminationProved: false };
    }
    if (magic !== STATUS_MAGIC || frame.length !== 16 || frame[5] >= STATES.length
        || frame[6] > 1 || frame[7] || frame[15]) return null;
    const values = [frame.readUInt16BE(8), frame.readUInt16BE(10), frame[12], frame[13], frame[14]];
    if (!validCounts(values)) return null;
    return { schema: 'observer-status-frame-1', source, state: STATES[frame[5]], faultPresent: frame[6] === 1,
      calls: values[0], pending: values[1], records: values[2], candidates: values[3], submitted: values[4],
      observation: 'instantaneous-adapter-status', naturalInstallationProved: false,
      requestCompletenessProved: false, ownerTerminationProved: false, wireReceiptProved: false };
  } catch (_) { return null; }
}
module.exports = Object.freeze({ encodeStatus, encodeFault, decode });
