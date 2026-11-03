'use strict';

// Explicit-install, memory-only, partial API observation. NOT a preload or recorder.
// No IO, callbacks/listeners, raw output, payload retention, or receipt assertion.
const { Buffer } = require('node:buffer');
const { projectHeaderShape } = require('./safe_value_checks.cjs');
const apply = Reflect.apply;
const descriptor = Object.getOwnPropertyDescriptor;
const define = Object.defineProperty;
const prototypeOf = Object.getPrototypeOf;
const byteLength = Buffer.byteLength;
const owners = new WeakSet();
const MAX_CALLS = 128;
const MAX_RECORDS = 4;
const MAX_STRING_BYTES = 256 * 1024;
const MAX_SCAN_BYTES = 512 * 1024;

// Only trusted ordinary prototypes/functions are supported. No arbitrary Proxy or
// patched-intrinsic guarantee. This entry also permits no-network test prototypes.
function installOnPrototype(prototype) {
  let state = 'not-installed';
  let fault = 'none';
  let calls = 0;
  let pending = 0;
  let scanBytes = 0;
  const records = [];
  const associations = new WeakMap();
  const patches = [];
  let owned = false;

  function fail(reason) {
    if (fault === 'none') fault = reason;
  }

  function enter(kind, receiver, args) {
    if (state !== 'active') { fail('late-call'); return null; }
    if ((typeof receiver !== 'object' || receiver === null)
        || prototypeOf(receiver) !== prototype) {
      fail('unsupported-receiver');
      return null;
    }
    let record = associations.get(receiver);
    if (!record) {
      if (records.length >= MAX_RECORDS) { fail('record-cap'); return null; }
      record = {
        ordinal: records.length + 1, depth: 0, wrote: false, endSeen: false,
        endReturned: false, body: 'no-end', header: projectHeaderShape(undefined),
      };
      associations.set(receiver, record);
      records.push(record);
    }
    if (record.depth !== 0) { record.body = 'reentrant'; fail('reentrant-request'); }
    if (kind === 'write') {
      record.wrote = true;
      if (record.body !== 'reentrant') record.body = 'write-seen';
    } else {
      if (record.endSeen) { record.body = 'repeated-end'; fail('repeated-end'); }
      else {
        record.endSeen = true;
        if (record.body !== 'reentrant' && !record.wrote) {
          // No coercion, enumeration or Buffer/typed-array inspection.
          if (args.length > 3) record.body = 'unsupported-arity';
          else if (typeof args[0] !== 'string') record.body = 'no-primitive-string';
          else if (!(args[1] === undefined || typeof args[1] === 'function'
              || args[1] === 'utf8' || args[1] === 'utf-8')) record.body = 'unsupported-encoding';
          else if (args[0].length > MAX_STRING_BYTES) record.body = 'string-cap';
          else {
            const size = byteLength(args[0], 'utf8');
            if (size > MAX_STRING_BYTES) record.body = 'string-cap';
            else if (scanBytes + size > MAX_SCAN_BYTES) {
              record.body = 'scan-cap'; fail('scan-cap');
            } else {
              // Commit before original call: nested calls cannot exceed this budget.
              // Only the scalar budget remains; no string or copy is stored.
              scanBytes += size;
              record.body = 'primitive-utf8-argument';
            }
          }
        }
      }
    }
    // All throwing classification work precedes acquisition of per-record depth.
    record.depth += 1;
    return { kind, receiver, record };
  }

  function leave(ticket, returned) {
    const record = ticket.record;
    try {
      if (!returned) { record.body = 'original-threw'; fail('original-threw'); }
      else if (ticket.kind === 'end') {
        record.endReturned = true;
        // No getter evaluation; Proxy receivers remain outside supported scope.
        const d = descriptor(ticket.receiver, '_header');
        record.header = projectHeaderShape(d && Object.hasOwn(d, 'value') ? d.value : undefined);
      }
    } finally {
      record.depth -= 1;
    }
  }

  function wrap(original, kind) {
    return function () {
      let ticket = null;
      let counted = false;
      try {
        if (calls >= MAX_CALLS) fail('call-cap');
        else {
          calls += 1;
          pending += 1;
          counted = true;
          ticket = enter(kind, this, arguments);
        }
      } catch (_) { fail('observer-fault'); }
      let returned = false;
      try {
        const result = apply(original, this, arguments);
        returned = true;
        return result;
      } finally {
        // No catch/inspection of the original throw; finally cannot replace it.
        try { if (ticket) leave(ticket, returned); }
        catch (_) { fail('observer-fault'); }
        finally { if (counted) pending -= 1; }
      }
    };
  }

  function restore() {
    let conflict = false;
    for (let i = patches.length - 1; i >= 0; i -= 1) {
      const patch = patches[i];
      if (!patch.applied) continue;
      try {
        const current = descriptor(prototype, patch.kind);
        if (!current || current.value !== patch.wrapper
            || current.writable !== patch.replacement.writable
            || current.enumerable !== patch.replacement.enumerable
            || current.configurable !== patch.replacement.configurable) {
          conflict = true;
          continue; // Never overwrite a later owner's property.
        }
        if (patch.own) define(prototype, patch.kind, patch.own);
        else if (!Reflect.deleteProperty(prototype, patch.kind)) conflict = true;
        patch.applied = false;
      } catch (_) { conflict = true; }
    }
    if (conflict) { fail('restore-conflict'); state = 'conflict'; }
    // Keep conflicted ownership locked; do not layer another observer over it.
    else if (owned) { owners.delete(prototype); owned = false; }
    return !conflict;
  }

  function snapshot() {
    // Build detached safe values; no caller serializers/sinks or raw references.
    return {
      schema: 'end-string-observer-1', state, fault, calls, pending,
      coverage: 'partial-api-only',
      requestCompletenessProved: false,
      wireReceiptProved: false,
      naturalInstallationProved: false,
      records: records.map(r => ({
        ordinal: r.ordinal, endSeen: r.endSeen, endReturned: r.endReturned,
        body: r.body,
        header: {
          ...r.header, authorization: { ...r.header.authorization },
        },
      })),
    };
  }

  function close() {
    if (state === 'closed' || state === 'conflict' || state === 'not-installed') return snapshot();
    state = 'closed'; // saved wrappers invoked later invalidate evidence, not APIs.
    if (pending !== 0) fail('close-pending');
    restore();
    return snapshot();
  }

  try {
    if (typeof prototype !== 'object' || prototype === null || owners.has(prototype)) {
      fail('install-refused');
    } else {
      // Resolve only bounded ordinary prototype descriptors, never invoke a getter.
      for (const kind of ['write', 'end']) {
        const own = descriptor(prototype, kind);
        let found = own;
        let p = prototype;
        for (let depth = 0; !found && depth < 4; depth += 1) {
          p = prototypeOf(p);
          if (!p) break;
          found = descriptor(p, kind);
        }
        if (!found || typeof found.value !== 'function'
            || (own && !own.configurable)) throw null;
        const wrapper = wrap(found.value, kind);
        for (const key of ['name', 'length']) {
          const meta = descriptor(found.value, key);
          if (meta && Object.hasOwn(meta, 'value')) define(wrapper, key, meta);
        }
        patches.push({ kind, own, wrapper, applied: false,
          replacement: { value: wrapper, writable: found.writable,
            enumerable: found.enumerable, configurable: own ? own.configurable : true } });
      }
      owners.add(prototype);
      owned = true;
      for (const patch of patches) {
        define(prototype, patch.kind, patch.replacement);
        patch.applied = true;
      }
      state = 'active';
    }
  } catch (_) {
    fail('install-failed');
    restore();
  }
  return Object.freeze({ snapshot, close });
}

function install() {
  // Import alone never patches Node. Call explicitly only under a reviewed case.
  const { ClientRequest } = require('node:http');
  return installOnPrototype(ClientRequest.prototype);
}

module.exports = Object.freeze({ install, installOnPrototype });
