'use strict';
// Separate from the old classification-only observer. Raw values go ONLY to the
// trusted internal RAM sink. Import never patches; no callbacks/listeners injected.
const { Buffer } = require('node:buffer');
const { LIMIT, ownValue, headerCandidate } = require('./traffic_values.cjs');
const apply = Reflect.apply, descriptor = Object.getOwnPropertyDescriptor;
const define = Object.defineProperty, prototypeOf = Object.getPrototypeOf;
const owners = new WeakSet();

function installOnPrototype(prototype, onCandidate, onFault) {
  let state = 'not-installed', fault = 'none', calls = 0, pending = 0;
  let aggregate = 0, candidates = 0, submitted = 0, owned = false;
  const records = [], patches = [], associations = new WeakMap();
  function fail(reason) {
    if (fault !== 'none') return;
    fault = reason;
    try { if (typeof onFault === 'function') onFault(reason); } catch (_) { /* No exception disclosure. */ }
  }
  function snapshot() {
    return { schema: 'node-http-ram-adapter-1', state, fault, calls, pending,
      records: records.length, candidates, submitted, coverage: 'partial-end-api-only',
      naturalInstallationProved: false, requestCompletenessProved: false, wireReceiptProved: false };
  }
  function enter(kind, receiver, args) {
    if (state !== 'active') { fail('late-call'); return null; }
    if (fault !== 'none') return null;
    if (receiver === null || typeof receiver !== 'object' || prototypeOf(receiver) !== prototype) {
      fail('unsupported-receiver'); return null;
    }
    let record = associations.get(receiver);
    if (!record) {
      if (records.length >= LIMIT.records) { fail('record-cap'); return null; }
      record = { depth: 0, wrote: false, endSeen: false };
      associations.set(receiver, record); records.push(record);
    }
    if (record.depth !== 0) { fail('reentrant-request'); return null; }
    let body;
    if (kind === 'write') {
      record.wrote = true;
      if (record.endSeen) fail('write-after-end');
    } else {
      if (record.endSeen) fail('repeated-end');
      record.endSeen = true;
      if (!record.wrote && args.length <= 3 && typeof args[0] === 'string'
          && (args[1] === undefined || typeof args[1] === 'function' || args[1] === 'utf8' || args[1] === 'utf-8')
          && (args[2] === undefined || typeof args[2] === 'function')) {
        if (args[0].length <= LIMIT.body && Buffer.byteLength(args[0], 'utf8') <= LIMIT.body) body = args[0];
      }
    }
    record.depth++;
    return { kind, receiver, record, body };
  }
  function leave(ticket, returned) {
    const record = ticket.record;
    try {
      if (!returned) { fail('original-threw'); return; }
      if (ticket.kind !== 'end' || fault !== 'none') return;
      const header = ownValue(ticket.receiver, '_header');
      const classification = headerCandidate(header);
      if (!classification || classification.kind !== 'h1' || !header.endsWith('\r\n\r\n')) {
        fail('unsupported-header'); return;
      }
      if (!classification.match) return;
      if (typeof ticket.body !== 'string') { fail('unsupported-candidate-body'); return; }
      if (candidates >= LIMIT.candidates) { fail('candidate-cap'); return; }
      const size = Buffer.byteLength(ticket.body, 'utf8');
      if (aggregate + size > LIMIT.aggregate) { fail('aggregate-cap'); return; }
      aggregate += size;
      const packet = { kind: 'candidate', ordinal: ++candidates,
        headerBoundary: 'node-http1-header-cache', bodyBoundary: 'primitive-utf8-end-argument',
        header, body: ticket.body, requestCompletenessProved: false, wireReceiptProved: false };
      try { onCandidate(packet); submitted++; }
      catch (_) { fail('sink-threw'); }
    } finally {
      ticket.body = undefined;
      record.depth--;
    }
  }
  function wrap(original, kind) {
    return function () {
      let ticket = null, counted = false;
      try {
        if (calls >= LIMIT.calls) fail('call-cap');
        else { calls++; pending++; counted = true; ticket = enter(kind, this, arguments); }
      } catch (_) { fail('observer-fault'); }
      let returned = false;
      try {
        const result = apply(original, this, arguments);
        returned = true;
        return result;
      } finally {
        try { if (ticket) leave(ticket, returned); }
        catch (_) { fail('observer-fault'); }
        finally { if (counted) pending--; }
      }
    };
  }
  function restore() {
    let conflict = false;
    for (let i = patches.length - 1; i >= 0; i--) {
      const p = patches[i];
      if (!p.applied) continue;
      try {
        const current = descriptor(prototype, p.kind);
        if (!current || current.value !== p.wrapper || current.writable !== p.replacement.writable
            || current.enumerable !== p.replacement.enumerable || current.configurable !== p.replacement.configurable) {
          conflict = true; continue;
        }
        if (p.own) define(prototype, p.kind, p.own);
        else if (!Reflect.deleteProperty(prototype, p.kind)) { conflict = true; continue; }
        p.applied = false;
      } catch (_) { conflict = true; }
    }
    if (conflict) { state = 'conflict'; fail('restore-conflict'); }
    else if (owned) { owners.delete(prototype); owned = false; }
  }
  function close() {
    if (state !== 'active') return snapshot();
    state = 'closed';
    if (pending !== 0) fail('close-pending');
    restore();
    return snapshot();
  }
  try {
    if (prototype === null || typeof prototype !== 'object' || owners.has(prototype)
        || typeof onCandidate !== 'function' || typeof onFault !== 'function') fail('install-refused');
    else {
      for (const kind of ['write', 'end']) {
        const own = descriptor(prototype, kind);
        let found = own, p = prototype;
        for (let i = 0; !found && i < 4; i++) {
          p = prototypeOf(p);
          if (!p) break;
          found = descriptor(p, kind);
        }
        if (!found || typeof found.value !== 'function' || own && !own.configurable) throw null;
        const wrapper = wrap(found.value, kind);
        for (const name of ['name', 'length']) {
          const meta = descriptor(found.value, name);
          if (meta && Object.hasOwn(meta, 'value')) define(wrapper, name, meta);
        }
        patches.push({ kind, own, wrapper, applied: false,
          replacement: { value: wrapper, writable: found.writable, enumerable: found.enumerable,
            configurable: own ? own.configurable : true } });
      }
      owners.add(prototype); owned = true;
      for (const p of patches) { define(prototype, p.kind, p.replacement); p.applied = true; }
      state = 'active';
    }
  } catch (_) { fail('install-failed'); restore(); }
  return Object.freeze({ snapshot, close });
}
function install(onCandidate, onFault) {
  return installOnPrototype(require('node:http').ClientRequest.prototype, onCandidate, onFault);
}
module.exports = Object.freeze({ install, installOnPrototype });
