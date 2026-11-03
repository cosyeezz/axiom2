'use strict';
// Explicit subscription. Trusted INTERNAL bounded-RAM sinks, never log these packets.
// No fetch/dispatcher/socket patch, iterator consumption, or network on import/install.
const dc = require('node:diagnostics_channel');
const { Buffer } = require('node:buffer');
const { TextDecoder } = require('node:util');
const { LIMIT, ownValue, headerCandidate, copyChunk } = require('./traffic_values.cjs');
let installed = false;

function install(onCandidate, onFault) {
  let state = 'not-installed', fault = 'none';
  let calls = 0, pending = 0, candidateCount = 0, submitted = 0, aggregate = 0;
  const associations = new WeakMap();
  const records = [];
  const subscriptions = [];
  let owns = false;

  function release(record) {
    record.header = undefined;
    record.chunks.length = 0;
  }
  function fail(reason) {
    if (fault !== 'none') return;
    fault = reason;
    for (const record of records) release(record);
    try { if (typeof onFault === 'function') onFault(reason); } catch (_) { /* Fixed sticky fault retained. */ }
  }
  function snapshot() {
    return { schema: 'undici-ram-adapter-1', state, fault, calls, pending,
      records: records.length, candidates: candidateCount, submitted,
      coverage: 'diagnostic-values-only', naturalInstallationProved: false,
      requestCompletenessProved: false, wireReceiptProved: false };
  }
  function callback(kind) {
    return function (message) {
      if (state !== 'active') { fail('late-event'); return; }
      if (calls >= LIMIT.calls) { fail('call-cap'); return; }
      calls++;
      if (fault !== 'none') return;
      pending++;
      try {
        const request = ownValue(message, 'request');
        if (request === null || typeof request !== 'object') { fail('unsupported-message'); return; }
        let record = associations.get(request);
        if (kind === 'headers') {
          if (record) { fail('repeated-headers'); return; }
          if (records.length >= LIMIT.records) { fail('record-cap'); return; }
          record = { candidate: false, sent: false, ordinal: 0,
            header: undefined, kind: undefined, chunks: [], bytes: 0, chunkCount: 0 };
          associations.set(request, record);
          records.push(record);
          const header = ownValue(message, 'headers');
          const classification = headerCandidate(header);
          if (!classification) { fail('unsupported-header'); return; }
          if (!classification.match) return;
          if (candidateCount >= LIMIT.candidates) { fail('candidate-cap'); return; }
          record.candidate = true;
          record.ordinal = ++candidateCount;
          record.header = header;
          record.kind = classification.kind;
          return;
        }
        // No raw values from unrelated or pre-install requests are inspected.
        if (!record?.candidate) return;
        if (kind === 'error') { fail('request-error'); return; }
        if (record.sent) { fail('late-request-event'); return; }
        if (kind === 'chunk') {
          if (record.chunkCount >= LIMIT.chunks) { fail('chunk-cap'); return; }
          const remaining = Math.min(LIMIT.body - record.bytes, LIMIT.aggregate - aggregate);
          const chunk = copyChunk(ownValue(message, 'chunk'), remaining);
          if (chunk === null) { fail('unsupported-or-oversized-chunk'); return; }
          record.chunkCount++;
          record.bytes += chunk.length;
          aggregate += chunk.length;
          record.chunks.push(chunk);
          return;
        }
        record.sent = true;
        const bytes = Buffer.concat(record.chunks, record.bytes);
        const body = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
        if (!Buffer.from(body, 'utf8').equals(bytes)) { fail('unsupported-utf8'); return; }
        const packet = {
          kind: 'candidate', ordinal: record.ordinal,
          headerBoundary: record.kind === 'h1' ? 'undici-h1-prefix' : 'undici-h2-text-view',
          bodyBoundary: 'diagnostic-chunks-at-callback',
          header: record.header, body,
          requestCompletenessProved: false, wireReceiptProved: false,
        };
        release(record);
        // Sink may retain at most the case budget in private RAM, never persistence.
        try { onCandidate(packet); submitted++; }
        catch (_) { fail('sink-threw'); }
      } catch (_) { fail('observer-fault'); }
      finally { pending--; }
    };
  }
  function unsubscribe() {
    let conflict = false;
    for (const subscription of subscriptions) {
      if (!subscription.active) continue;
      try {
        if (!subscription.channel.unsubscribe(subscription.listener)) conflict = true;
        else subscription.active = false;
      } catch (_) { conflict = true; }
    }
    if (conflict) { state = 'conflict'; fail('unsubscribe-conflict'); }
    else if (owns) { installed = false; owns = false; }
  }
  function close() {
    if (state !== 'active') return snapshot();
    state = 'closed';
    if (pending !== 0) fail('close-pending');
    if (records.some(record => record.candidate && !record.sent)) fail('incomplete-candidate');
    unsubscribe();
    for (const record of records) release(record);
    return snapshot();
  }
  try {
    if (installed || typeof onCandidate !== 'function' || typeof onFault !== 'function') {
      fail('install-refused');
    } else {
      installed = true; owns = true;
      for (const [name, kind] of [
        ['undici:client:sendHeaders', 'headers'],
        ['undici:request:bodyChunkSent', 'chunk'],
        ['undici:request:bodySent', 'sent'],
        ['undici:request:error', 'error'],
      ]) {
        const channel = dc.channel(name), listener = callback(kind);
        const subscription = { channel, listener, active: true };
        subscriptions.push(subscription);
        channel.subscribe(listener);
      }
      state = 'active';
    }
  } catch (_) {
    fail('install-failed');
    unsubscribe();
  }
  return Object.freeze({ snapshot, close });
}

module.exports = Object.freeze({ install });
