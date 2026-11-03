'use strict';
// Pure supplied-value comparison; no capture, IO, input hashes or overall parity pass.
const { Buffer } = require('node:buffer');
const { comparePayloadUtf8 } = require('../observer-real-auth-01/safe_value_checks.cjs');
const MAX_BYTES = 256 * 1024;
const MAX_DEPTH = 32;
const fields = Object.freeze([
  ['conversationState', ['conversationState']],
  ['profileArn', ['profileArn']],
  ['agentMode', ['agentMode']],
  ['additionalModelRequestFields', ['additionalModelRequestFields']],
  ['systemPrompt', ['systemPrompt']],
  ['conversationId', ['conversationState', 'conversationId']],
  ['chatTriggerType', ['conversationState', 'chatTriggerType']],
  ['history', ['conversationState', 'history']],
  ['currentMessage', ['conversationState', 'currentMessage']],
  ['currentModelId', ['conversationState', 'currentMessage', 'userInputMessage', 'modelId']],
  ['currentContent', ['conversationState', 'currentMessage', 'userInputMessage', 'content']],
  ['currentOrigin', ['conversationState', 'currentMessage', 'userInputMessage', 'origin']],
  ['currentContext', ['conversationState', 'currentMessage', 'userInputMessage', 'userInputMessageContext']],
  ['currentTools', ['conversationState', 'currentMessage', 'userInputMessage', 'userInputMessageContext', 'tools']],
]);

function inspect(value) {
  if (typeof value !== 'string') return { state: 'unsupported-type' };
  if (value.length > MAX_BYTES || Buffer.byteLength(value, 'utf8') > MAX_BYTES) return { state: 'byte-cap' };
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === 92) escaped = true;
      else if (c === 34) quoted = false;
    } else if (c === 34) quoted = true;
    else if (c === 123 || c === 91) {
      depth++;
      if (depth > MAX_DEPTH) return { state: 'depth-cap' };
    } else if (c === 125 || c === 93) {
      if (--depth < 0) return { state: 'invalid-json' };
    }
  }
  try {
    const parsed = JSON.parse(value);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { state: 'unsupported-root' };
    // Acceptance guard, NOT normalization: duplicates, precision loss, alternate
    // spelling/whitespace/order produce unknown structured comparison, not equality.
    if (JSON.stringify(parsed) !== value) return { state: 'noncanonical-json' };
    return { state: 'canonical-object', value: parsed };
  } catch (_) {
    return { state: 'invalid-json' };
  }
}

function pick(root, path) {
  let value = root;
  for (const key of path) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return { present: false };
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !Object.hasOwn(d, 'value')) return { present: false };
    value = d.value;
  }
  return { present: true, value };
}

function compareRequestBodies(left, right) {
  const utf8 = comparePayloadUtf8(left, right);
  let a;
  let b;
  const comparisons = {};
  try {
    a = inspect(left);
    b = inspect(right);
    const structured = a.state === 'canonical-object' && b.state === 'canonical-object';
    for (const [name, path] of fields) {
      if (!structured) {
        comparisons[name] = { leftPresent: null, rightPresent: null, valuesEqual: null };
        continue;
      }
      const x = pick(a.value, path);
      const y = pick(b.value, path);
      comparisons[name] = {
        leftPresent: x.present,
        rightPresent: y.present,
        // Absence is not an equality assertion. Different presence is explicit.
        valuesEqual: x.present && y.present ? JSON.stringify(x.value) === JSON.stringify(y.value) : null,
      };
    }
    return {
      schema: 'provided-body-pair-1',
      boundary: 'supplied-values-only',
      utf8,
      leftStructuredState: a.state,
      rightStructuredState: b.state,
      fields: comparisons,
      originalInputsRewritten: false,
      dynamicDifferencesNormalized: false,
      unknownFieldsCoveredByWholeUtf8Comparison: true,
      completeRequestEqualityProved: false,
      authenticationParityProved: false,
      wireReceiptProved: false,
    };
  } catch (_) {
    // No error message/stack/context, raw value, arbitrary key or fallback hash.
    return {
      schema: 'provided-body-pair-1', boundary: 'supplied-values-only', utf8,
      leftStructuredState: 'comparison-fault', rightStructuredState: 'comparison-fault',
      fields: null, originalInputsRewritten: false, dynamicDifferencesNormalized: false,
      unknownFieldsCoveredByWholeUtf8Comparison: true, completeRequestEqualityProved: false,
      authenticationParityProved: false, wireReceiptProved: false,
    };
  }
}

module.exports = Object.freeze({ compareRequestBodies });
