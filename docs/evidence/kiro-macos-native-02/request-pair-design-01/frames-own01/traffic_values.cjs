'use strict';
// Internal primitives only. No IO/installation/raw-output projection.
const { Buffer } = require('node:buffer');
const apply = Reflect.apply;
const descriptor = Object.getOwnPropertyDescriptor;
const typed = Object.getPrototypeOf(Uint8Array.prototype);
const getBuffer = descriptor(typed, 'buffer').get;
const getOffset = descriptor(typed, 'byteOffset').get;
const getLength = descriptor(typed, 'byteLength').get;
const getTag = descriptor(typed, Symbol.toStringTag).get;
const getArrayLength = descriptor(ArrayBuffer.prototype, 'byteLength').get;
const getResizable = descriptor(ArrayBuffer.prototype, 'resizable')?.get;
const isView = ArrayBuffer.isView;
const LIMIT = Object.freeze({ calls: 128, records: 16, candidates: 4,
  body: 262144, header: 65536, aggregate: 524288, chunks: 256 });

function ownValue(object, key) {
  if (object === null || typeof object !== 'object') return undefined;
  const d = descriptor(object, key);
  return d && Object.hasOwn(d, 'value') ? d.value : undefined;
}

function headerCandidate(header) {
  if (typeof header !== 'string' || header.length > LIMIT.header
      || /[^\x09\x0a\x0d\x20-\x7e]/.test(header)) return null;
  const lines = header.split('\r\n');
  if (lines.length < 2 || lines.length > 132 || lines.at(-1) !== '' || lines[0].length > 8192) return null;
  const first = /^([^ \t\r\n]+) ([^ \t\r\n]+) HTTP\/(1\.[01])$/.exec(lines[0]);
  const kind = first ? 'h1' : 'h2';
  let method = first?.[1];
  let path = first?.[2];
  let methods = 0, paths = 0, targets = 0, target;
  let empty = 0;
  for (let i = first ? 1 : 0; i < lines.length - 1; i++) {
    const line = lines[i];
    if (line === '') { if (++empty > 1) return null; continue; }
    if (empty || line.length > 8192) return null;
    const colon = line.indexOf(':', line.startsWith(':') ? 1 : 0);
    if (colon <= 0 || colon > 128) return null;
    const name = line.slice(0, colon);
    if (!/^:?[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)
        || kind === 'h1' && name.startsWith(':')) return null;
    const value = line.slice(colon + 1);
    if (/[\r\n]/.test(value)) return null;
    const normalized = value.replace(/^[ \t]+|[ \t]+$/g, '');
    const lower = name.toLowerCase();
    if (lower === ':method') { methods++; method = normalized; }
    if (lower === ':path') { paths++; path = normalized; }
    if (lower === 'x-amz-target') { targets++; target = normalized; }
  }
  if (kind === 'h2' && (methods !== 1 || paths > 1 || paths === 0 && method !== 'CONNECT')) return null;
  const match = method === 'POST' && (path === '/generateAssistantResponse'
    || path === '/v1/responses' || path === '/' && targets === 1
      && target === 'AmazonCodeWhispererStreamingService.GenerateAssistantResponse');
  // Parsed values never escape. Original header remains unchanged in the caller.
  return { kind, match };
}

function copyChunk(value, maximum) {
  if (!Number.isInteger(maximum) || maximum < 0 || maximum > LIMIT.body) return null;
  try {
    if (typeof value === 'string') {
      if (value.length > maximum || Buffer.byteLength(value, 'utf8') > maximum) return null;
      return Buffer.from(value, 'utf8');
    }
    if (!isView(value) || apply(getTag, value, []) !== 'Uint8Array') return null;
    const buffer = apply(getBuffer, value, []);
    // ArrayBuffer getter rejects SharedArrayBuffer without inspecting user fields.
    apply(getArrayLength, buffer, []);
    if (getResizable && apply(getResizable, buffer, [])) return null;
    const length = apply(getLength, value, []);
    const offset = apply(getOffset, value, []);
    if (length > maximum) return null;
    return Buffer.from(new Uint8Array(buffer, offset, length));
  } catch (_) { return null; }
}

module.exports = Object.freeze({ LIMIT, ownValue, headerCandidate, copyChunk });
