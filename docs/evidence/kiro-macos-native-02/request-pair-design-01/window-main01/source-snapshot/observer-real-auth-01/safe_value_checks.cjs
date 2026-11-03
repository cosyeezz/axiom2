'use strict';

// Pure memory-only predicates. NOT an HTTP tap, preload, or receipt attestation.
// No IO, caller coercion, raw values, input digests, or arbitrary names in output.
const { Buffer } = require('node:buffer');
const byteLength = Buffer.byteLength;
const fromString = Buffer.from;
const compareBuffers = Buffer.compare;
const MAX_PAYLOAD_BYTES = 256 * 1024;
const MAX_HEADER_BYTES = 64 * 1024;

function validLimit(value, maximum) {
  return Number.isSafeInteger(value) && value > 0 && value <= maximum;
}

function valueResult(result, reason, codeUnitsEqual = null) {
  return {
    schema: 'real-http-value-check-1',
    check: 'provided-utf8-payloads',
    result,
    reason,
    inputCodeUnitsEqual: codeUnitsEqual,
    boundary: 'provided-values-only',
    requestCompletenessProved: false,
    wireReceiptProved: false,
  };
}

function comparePayloadUtf8(left, right, maxBytes = MAX_PAYLOAD_BYTES) {
  if (!validLimit(maxBytes, MAX_PAYLOAD_BYTES)) return valueResult('unknown', 'invalid-bound');
  if (typeof left !== 'string' || typeof right !== 'string') {
    return valueResult('unknown', 'unsupported-input-type');
  }
  // UTF8 byte length is at least the primitive string's UTF16 code-unit length.
  // Refuse oversized inputs before a scan or allocation. Bound BOTH allocations.
  if (left.length > maxBytes || right.length > maxBytes) return valueResult('unknown', 'byte-cap');
  try {
    if (byteLength(left, 'utf8') > maxBytes || byteLength(right, 'utf8') > maxBytes) {
      return valueResult('unknown', 'byte-cap');
    }
    const a = fromString(left, 'utf8');
    const b = fromString(right, 'utf8');
    const result = compareBuffers(a, b) === 0 ? 'equal' : 'different';
    // Different ill-formed UTF16 strings can encode as the same replacement bytes.
    // Report that distinction; never call this complete-request equality.
    return valueResult(result, 'complete-provided-values', left === right);
  } catch (_) {
    // No exception inspection, message, stack, context or input fallback.
    return valueResult('unknown', 'conversion-failed');
  }
}

function authShape(present = null, duplicate = null, scheme = 'unknown',
  form = 'unknown', tokenShape = 'unknown') {
  return { present, duplicate, scheme, form, tokenShape, scope: 'unknown' };
}

function unknownHeader(reason) {
  return {
    schema: 'real-http-header-shape-1',
    coverage: 'unknown', reason,
    method: 'unknown', httpVersion: 'unknown', endpoint: 'unknown', queryPresent: null,
    authorization: authShape(), otherHeadersPresent: null,
    valueEqualityProved: false, wireReceiptProved: false,
  };
}

function knownMethod(value) {
  switch (value) {
    case 'GET': case 'POST': case 'HEAD': case 'PUT': case 'PATCH':
    case 'DELETE': case 'OPTIONS': case 'CONNECT': case 'TRACE': return value;
    default: return 'other';
  }
}

function knownEndpoint(method, target) {
  // Exact source-backed candidate routes only. Query, absolute-form URL, fragments
  // and all other routes stay unknown; no substring or raw-path fallback.
  if (method === 'POST' && target === '/generateAssistantResponse') return 'generate-assistant-response';
  if (method === 'POST' && target === '/v1/responses') return 'create-response';
  return 'unknown';
}

function projectHeaderShape(value, maxBytes = 16 * 1024) {
  if (!validLimit(maxBytes, MAX_HEADER_BYTES)) return unknownHeader('invalid-bound');
  if (typeof value !== 'string') return unknownHeader('unsupported-input-type');
  if (value.length > maxBytes) return unknownHeader('header-cap');
  try {
    // This revision supports ASCII header-cache text only. CR/LF/HTAB are parsed
    // below; unsupported text remains unknown, never a lossy sanitized string.
    if (/[^\x09\x0a\x0d\x20-\x7e]/.test(value)) return unknownHeader('unsupported-text');
    const lines = value.split('\r\n');
    if (lines.length < 3 || lines[lines.length - 1] !== '' || lines[lines.length - 2] !== '') {
      return unknownHeader('header-grammar');
    }
    if (lines.length - 3 > 64) return unknownHeader('header-count-cap');
    if (lines[0].length > 8192) return unknownHeader('header-line-cap');
    const first = /^([^ \t\r\n]+) ([^ \t\r\n]+) HTTP\/(1\.[01])$/.exec(lines[0]);
    if (!first) return unknownHeader('header-grammar');
    let authorizationCount = 0;
    let authorizationValue = '';
    let otherHeaders = false;
    for (let i = 1; i < lines.length - 2; i += 1) {
      const line = lines[i];
      if (line.length > 8192) return unknownHeader('header-line-cap');
      const colon = line.indexOf(':');
      if (colon <= 0 || colon > 128) return unknownHeader('header-grammar');
      const name = line.slice(0, colon);
      if (!/^[-!#$%&'*+.^_`|~0-9A-Za-z]+$/.test(name)) return unknownHeader('header-grammar');
      const content = line.slice(colon + 1);
      // No bare CR/LF: no folded/ambiguous or body-like input classification.
      if (/[\r\n]/.test(content)) return unknownHeader('header-grammar');
      if (name.toLowerCase() === 'authorization') {
        authorizationCount += 1;
        authorizationValue = content.replace(/^[ \t]+|[ \t]+$/g, '');
      } else {
        // Arbitrary names/values are not emitted, including a secret in the name.
        otherHeaders = true;
      }
    }
    let auth;
    if (authorizationCount === 0) auth = authShape(false, false, 'absent', 'absent', 'absent');
    else if (authorizationCount > 1) auth = authShape(true, true);
    else {
      const prefix = /^Bearer(?:[ \t]+|$)/i.exec(authorizationValue);
      if (!prefix) auth = authShape(true, false, 'other');
      else {
        const token = authorizationValue.slice(prefix[0].length);
        if (!/^[\x21-\x7e]+$/.test(token)) auth = authShape(true, false, 'bearer', 'unrecognized');
        else {
          const shape = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
            ? 'three-segment' : 'opaque';
          auth = authShape(true, false, 'bearer', 'nonempty-ascii', shape);
        }
      }
    }
    return {
      schema: 'real-http-header-shape-1',
      coverage: 'format-only', reason: 'bounded-header-cache',
      method: knownMethod(first[1]), httpVersion: first[3],
      endpoint: knownEndpoint(first[1], first[2]), queryPresent: first[2].includes('?'),
      authorization: auth, otherHeadersPresent: otherHeaders,
      // Equal projections are NOT evidence of equal original values.
      valueEqualityProved: false, wireReceiptProved: false,
    };
  } catch (_) {
    return unknownHeader('projection-failed');
  }
}

module.exports = Object.freeze({ comparePayloadUtf8, projectHeaderShape });
