'use strict';
// Candidate-only private RAM framing. No IO, automatic install, or public raw projection.
const { Buffer } = require('node:buffer');
const { LIMIT, ownValue, headerCandidate, copyChunk } = require('./traffic_values.cjs');
const PREFIX = 16, FRAME_MAX = PREFIX + LIMIT.header + 2 * LIMIT.body;
const STREAM_MAX = 4 * PREFIX + 4 * LIMIT.header + 2 * LIMIT.aggregate;
const MAGIC = 0x4b505231;
const LABELS = [null, 'node-http1-header-cache', 'undici-h1-prefix', 'undici-h2-text-view'];
const KEYS = ['kind', 'ordinal', 'headerBoundary', 'bodyBoundary', 'header', 'body',
  'requestCompletenessProved', 'wireReceiptProved'];
const typed = Object.getPrototypeOf(Uint8Array.prototype);
const getter = key => Object.getOwnPropertyDescriptor(typed, key).get;
const getBuffer = getter('buffer'), getOffset = getter('byteOffset'), getLength = getter('byteLength');
const getTag = getter(Symbol.toStringTag);
const getArrayLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
const getResizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get;
const apply = Reflect.apply;

function packetInfo(packet) {
  if (!packet || typeof packet !== 'object' || Object.getOwnPropertySymbols(packet).length) return null;
  const keys = Object.getOwnPropertyNames(packet);
  if (keys.length !== KEYS.length || !keys.every(key => KEYS.includes(key))) return null;
  const header = ownValue(packet, 'header'), body = ownValue(packet, 'body');
  const ordinal = ownValue(packet, 'ordinal'), code = LABELS.indexOf(ownValue(packet, 'headerBoundary'));
  if (ownValue(packet, 'kind') !== 'candidate' || code < 1
      || !Number.isInteger(ordinal) || ordinal < 1 || ordinal > 4
      || ownValue(packet, 'requestCompletenessProved') !== false || ownValue(packet, 'wireReceiptProved') !== false
      || ownValue(packet, 'bodyBoundary') !== (code === 1 ? 'primitive-utf8-end-argument' : 'diagnostic-chunks-at-callback')
      || typeof body !== 'string' || body.length > LIMIT.body || Buffer.byteLength(body, 'utf8') > LIMIT.body) return null;
  const classification = headerCandidate(header);
  if (!classification?.match || classification.kind !== (code === 3 ? 'h2' : 'h1')) return null;
  if (code === 1 && !header.endsWith('\r\n\r\n')) return null;
  return { code, ordinal, header, body };
}
function encode(packet) {
  try {
    const p = packetInfo(packet);
    if (!p) return null;
    const frame = Buffer.alloc(PREFIX + p.header.length + 2 * p.body.length);
    frame.writeUInt32BE(MAGIC, 0); frame[4] = p.code; frame[5] = p.ordinal;
    frame.writeUInt32BE(p.header.length, 8); frame.writeUInt32BE(p.body.length, 12);
    frame.write(p.header, PREFIX, p.header.length, 'ascii');
    frame.write(p.body, PREFIX + p.header.length, 2 * p.body.length, 'utf16le');
    return frame;
  } catch (_) { return null; }
}
function expectedSize(prefix) {
  if (prefix.length < PREFIX || prefix.readUInt32BE(0) !== MAGIC
      || prefix[4] < 1 || prefix[4] > 3 || prefix[5] < 1 || prefix[5] > 4 || prefix[6] || prefix[7]) return null;
  const header = prefix.readUInt32BE(8), body = prefix.readUInt32BE(12);
  if (header === 0 || header > LIMIT.header || body > LIMIT.body) return null;
  return PREFIX + header + 2 * body;
}
function copyFrame(input) {
  if (!ArrayBuffer.isView(input) || apply(getTag, input, []) !== 'Uint8Array') return null;
  const buffer = apply(getBuffer, input, []);
  apply(getArrayLength, buffer, []);
  if (getResizable && apply(getResizable, buffer, [])) return null;
  const length = apply(getLength, input, []), offset = apply(getOffset, input, []);
  if (length > FRAME_MAX) return null;
  return Buffer.from(new Uint8Array(buffer, offset, length));
}
function decode(input) {
  try {
    const frame = copyFrame(input);
    if (!frame || expectedSize(frame) !== frame.length) return null;
    const code = frame[4], headerLength = frame.readUInt32BE(8);
    const packet = { kind: 'candidate', ordinal: frame[5], headerBoundary: LABELS[code],
      bodyBoundary: code === 1 ? 'primitive-utf8-end-argument' : 'diagnostic-chunks-at-callback',
      header: frame.toString('latin1', PREFIX, PREFIX + headerLength),
      body: frame.toString('utf16le', PREFIX + headerLength),
      requestCompletenessProved: false, wireReceiptProved: false };
    return packetInfo(packet) ? packet : null;
  } catch (_) { return null; }
}
function createReader(onCandidate, onFault) {
  let state = 'open', fault = 'none', calls = 0, bytes = 0, frames = 0, delivered = 0, aggregate = 0;
  let used = 0, expected = PREFIX, busy = false;
  const ordinals = [0, 0], storage = Buffer.alloc(FRAME_MAX);
  function fail(reason) {
    if (fault !== 'none') return;
    fault = reason; storage.fill(0); used = 0;
    try { if (typeof onFault === 'function') onFault(reason); } catch (_) { /* Fixed sticky fault only. */ }
  }
  function snapshot() {
    return { schema: 'candidate-frame-reader-1', state, fault, calls, bytes, frames, delivered,
      coverage: 'candidate-values-only', requestCompletenessProved: false,
      ownerTerminationProved: false, wireReceiptProved: false };
  }
  function push(input) {
    if (state !== 'open') { fail('late-input'); return false; }
    if (busy) { fail('reentrant-input'); return false; }
    if (fault !== 'none') return false;
    if (calls >= 1024) { fail('call-cap'); return false; }
    calls++; busy = true;
    try {
      // Network owner must supply native byte buffers, not text/coercible objects.
      if (typeof input === 'string') { fail('unsupported-chunk'); return false; }
      const chunk = copyChunk(input, 65536);
      if (!chunk) { fail('unsupported-chunk'); return false; }
      if (bytes + chunk.length > STREAM_MAX) { fail('stream-cap'); return false; }
      bytes += chunk.length;
      let offset = 0;
      while (offset < chunk.length) {
        const n = Math.min(expected - used, chunk.length - offset);
        chunk.copy(storage, used, offset, offset + n); used += n; offset += n;
        if (used === PREFIX && expected === PREFIX) {
          const size = expectedSize(storage.subarray(0, PREFIX));
          if (size === null) { fail('invalid-prefix'); return false; }
          expected = size;
        }
        if (used !== expected) continue;
        if (frames >= 4) { fail('frame-cap'); return false; }
        const packet = decode(storage.subarray(0, used));
        if (!packet) { fail('invalid-frame'); return false; }
        const source = packet.headerBoundary === LABELS[1] ? 0 : 1;
        if (packet.ordinal !== ordinals[source] + 1) { fail('invalid-ordinal'); return false; }
        const size = Buffer.byteLength(packet.body, 'utf8');
        if (aggregate + size > LIMIT.aggregate) { fail('aggregate-cap'); return false; }
        ordinals[source]++; aggregate += size; frames++;
        storage.fill(0, 0, used); used = 0; expected = PREFIX;
        try { onCandidate(packet); delivered++; }
        catch (_) { fail('sink-threw'); return false; }
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
    else if (used !== 0) fail('truncated-frame');
    storage.fill(0); used = 0;
    return snapshot();
  }
  if (typeof onCandidate !== 'function' || typeof onFault !== 'function') fail('invalid-sink');
  return Object.freeze({ push, finish, snapshot });
}
module.exports = Object.freeze({ encode, decode, createReader,
  limits: Object.freeze({ prefix: PREFIX, frame: FRAME_MAX, stream: STREAM_MAX, chunk: 65536, calls: 1024 }) });
