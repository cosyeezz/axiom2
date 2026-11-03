'use strict';
// Bounded candidate/control demultiplexer, no IO and no owner-terminal claim.
const { Buffer } = require('node:buffer');
const candidates = require('./candidate_frames.cjs');
const control = require('./control_frames.cjs');
const { copyChunk } = require('./traffic_values.cjs');
const MAX_CONTROLS = 32, MAX_BYTES = candidates.limits.stream + MAX_CONTROLS * 16;
function createReader(onCandidate, onControl, onFault) {
  let state = 'open', fault = 'none', busy = false, calls = 0, bytes = 0, controls = 0;
  let used = 0, need = 4, kind = 0, remaining = 0;
  const prefix = Buffer.alloc(16);
  function fail(reason) {
    if (fault !== 'none') return;
    fault = reason; prefix.fill(0); used = 0;
    try { if (typeof onFault === 'function') onFault(reason); } catch (_) { /* No error values retained. */ }
  }
  const reader = candidates.createReader(packet => onCandidate(packet), () => fail('candidate-reader-fault'));
  function snapshot() {
    return { schema: 'multiplex-reader-1', state, fault, calls, bytes, controls,
      candidateReader: reader.snapshot(), requestCompletenessProved: false,
      ownerTerminationProved: false, wireReceiptProved: false };
  }
  function resetPrefix() { prefix.fill(0); used = 0; need = 4; kind = 0; }
  function push(input) {
    if (state !== 'open') { fail('late-input'); return false; }
    if (busy) { fail('reentrant-input'); return false; }
    if (fault !== 'none') return false;
    if (calls >= 1024) { fail('call-cap'); return false; }
    calls++; busy = true;
    try {
      if (typeof input === 'string') { fail('unsupported-chunk'); return false; }
      const chunk = copyChunk(input, candidates.limits.chunk);
      if (!chunk) { fail('unsupported-chunk'); return false; }
      if (bytes + chunk.length > MAX_BYTES) { fail('stream-cap'); return false; }
      bytes += chunk.length;
      let offset = 0;
      while (offset < chunk.length) {
        if (remaining) {
          const n = Math.min(remaining, chunk.length - offset);
          if (!reader.push(chunk.subarray(offset, offset + n))) { fail('candidate-reader-fault'); return false; }
          offset += n; remaining -= n;
          if (fault !== 'none' || state !== 'open') return false;
          continue;
        }
        const n = Math.min(need - used, chunk.length - offset);
        chunk.copy(prefix, used, offset, offset + n); used += n; offset += n;
        if (used !== need) continue;
        if (need === 4) {
          const magic = prefix.readUInt32BE(0);
          if (magic === 0x4b505231) { kind = 1; need = 16; }
          else if (magic === 0x4b505331) { kind = 2; need = 16; }
          else if (magic === 0x4b504631) { kind = 3; need = 8; }
          else { fail('invalid-magic'); return false; }
          continue;
        }
        if (kind === 1) {
          const h = prefix.readUInt32BE(8), b = prefix.readUInt32BE(12);
          if (!h || h > 65536 || b > 262144) { fail('invalid-prefix'); return false; }
          // The existing reader independently validates labels, ordinal and reserved bytes.
          if (!reader.push(prefix)) { fail('candidate-reader-fault'); return false; }
          remaining = h + 2 * b;
          resetPrefix();
          continue;
        }
        if (controls >= MAX_CONTROLS) { fail('control-cap'); return false; }
        const value = control.decode(prefix.subarray(0, need));
        if (!value) { fail('invalid-control'); return false; }
        controls++; resetPrefix();
        if (value.faultPresent) fail('remote-observer-fault');
        try { onControl(value); } catch (_) { fail('control-sink-threw'); }
        if (fault !== 'none' || state !== 'open') return false;
      }
      return true;
    } catch (_) { fail('reader-fault'); return false; }
    finally { busy = false; }
  }
  function finish() {
    if (state !== 'open') return snapshot();
    state = 'ended';
    if (busy) fail('finish-pending');
    else if (used || remaining) fail('truncated-stream');
    reader.finish(); prefix.fill(0); used = 0; remaining = 0;
    return snapshot();
  }
  if ([onCandidate, onControl, onFault].some(fn => typeof fn !== 'function')) fail('invalid-sink');
  return Object.freeze({ push, snapshot, finish });
}
module.exports = Object.freeze({ createReader,
  limits: Object.freeze({ controls: MAX_CONTROLS, bytes: MAX_BYTES, chunk: candidates.limits.chunk, calls: 1024 }) });
