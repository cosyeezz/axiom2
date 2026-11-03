'use strict';

// Self-owned fake calibration only. API input bytes are NOT wire/receipt bytes.
const active = new WeakSet();

function install(libs, sink, options = {}) {
  const limit = Object.assign({ events: 128, bodyBytes: 256 * 1024, logBytes: 1024 * 1024 }, options);
  for (const n of Object.values(limit)) {
    if (!Number.isSafeInteger(n) || n <= 0) throw new TypeError('positive integer limits required');
  }
  if (typeof sink !== 'function') throw new TypeError('sink function required');
  const proto = libs.http.ClientRequest.prototype;
  if (active.has(proto)) throw new Error('already installed');
  const state = { ok: true, reason: null, events: 0, bodyBytes: 0, logBytes: 0, requests: 0 };
  const ids = new WeakMap();
  const restores = [];
  function fault(reason) {
    if (state.ok) { state.ok = false; state.reason = reason; }
  }
  function emit(event) {
    if (!state.ok) return;
    try {
      const bytes = Buffer.byteLength(JSON.stringify(event)) + 1;
      if (state.events + 1 > limit.events || state.logBytes + bytes > limit.logBytes) {
        fault('event-or-log-cap'); return;
      }
      state.events += 1;
      state.logBytes += bytes;
      sink(event);
    } catch (_) { fault('observer-sink-failed'); }
  }
  function identify(req) {
    if ((typeof req !== 'object' && typeof req !== 'function') || req === null) {
      fault('request-not-object'); return null;
    }
    let id = ids.get(req);
    if (id === undefined) {
      id = ++state.requests;
      ids.set(req, id);
      // Read created request fields, never read input option getters again.
      emit({ kind: 'request', id, method: typeof req.method === 'string' ? req.method : null,
        path: typeof req.path === 'string' ? req.path : null });
    }
    return id;
  }
  function sample(args, kind) {
    const value = args[0];
    if (kind === 'end' && (value == null || typeof value === 'function')) return { bytes: 0, bodyBase64: '' };
    try {
      let bytes;
      if (typeof value === 'string') {
        const encoding = typeof args[1] === 'string' ? args[1] : 'utf8';
        const length = Buffer.byteLength(value, encoding);
        if (length > limit.bodyBytes - state.bodyBytes) return { cap: true };
        bytes = Buffer.from(value, encoding);
      } else if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
        if (value.byteLength > limit.bodyBytes - state.bodyBytes) return { cap: true };
        bytes = Buffer.from(value);
      } else return { unavailable: true };
      return { bytes: bytes.length, bodyBase64: bytes.toString('base64') };
    } catch (_) { return { unavailable: true }; }
  }
  function patch(object, name, wrapperFactory) {
    const own = Object.getOwnPropertyDescriptor(object, name);
    const original = object[name];
    if (typeof original !== 'function') throw new TypeError('unsupported API: ' + name);
    const wrapper = wrapperFactory(original);
    Object.defineProperty(wrapper, 'name', { value: original.name, configurable: true });
    Object.defineProperty(wrapper, 'length', { value: original.length, configurable: true });
    Object.defineProperty(object, name, { value: wrapper, writable: true, configurable: true,
      enumerable: own ? own.enumerable : false });
    restores.push(() => {
      if (own) Object.defineProperty(object, name, own);
      else delete object[name];
    });
  }
  try {
    for (const [api, library] of [['http.request', libs.http], ['https.request', libs.https]]) {
      patch(library, 'request', original => function (...args) {
        // Exactly once, with the original receiver and the original arguments.
        let value;
        try { value = Reflect.apply(original, this, args); }
        catch (error) { emit({ kind: 'request-call', api, originalReturned: false }); throw error; }
        try { emit({ kind: 'request-call', api, id: identify(value), originalReturned: true }); }
        catch (_) { fault('observer-request-metadata-failed'); }
        return value;
      });
    }
    for (const kind of ['write', 'end']) {
      patch(proto, kind, original => function (...args) {
        let id = null;
        let input = null;
        try { id = identify(this); if (state.ok) input = sample(args, kind); }
        catch (_) { fault('observer-input-failed'); }
        let value;
        try { value = Reflect.apply(original, this, args); }
        catch (error) {
          emit({ kind, id, originalReturned: false });
          // Do not inspect, wrap or replace the original thrown object.
          throw error;
        }
        if (input && input.cap) fault('body-cap');
        else if (input && input.unavailable) fault('unrecordable-returned-input');
        else if (input) {
          state.bodyBytes += input.bytes;
          emit({ kind, id, originalReturned: true, returnType: typeof value,
            returnIsThis: value === this, booleanReturn: typeof value === 'boolean' ? value : null,
            bytes: input.bytes, bodyBase64: input.bodyBase64 });
        }
        return value;
      });
    }
    patch(proto, '_storeHeader', original => function (...args) {
      // Observe the resulting header cache only AFTER the original method.
      let value;
      try { value = Reflect.apply(original, this, args); }
      catch (error) { emit({ kind: 'header-call', originalReturned: false }); throw error; }
      try {
        const id = identify(this);
        if (typeof this._header !== 'string') fault('header-cache-not-string');
        else emit({ kind: 'header-cache', id, value: this._header });
      } catch (_) { fault('observer-header-failed'); }
      return value;
    });
    active.add(proto);
  } catch (error) {
    for (const restore of restores.reverse()) restore();
    throw error;
  }
  let removed = false;
  return {
    status() { return Object.assign({}, state); },
    uninstall() {
      if (!removed) {
        removed = true;
        for (const restore of restores.reverse()) restore();
        active.delete(proto);
      }
    },
  };
}

let automatic = null;
if (module.isPreloading && process.env.AXIOM_FAKE_ONLY !== 'only-self-owned-http-fixture') {
  throw new Error('fake observer requires explicit self-owned fixture guard');
}
if (process.env.AXIOM_FAKE_ONLY === 'only-self-owned-http-fixture') {
  const fs = require('node:fs');
  const path = require('node:path');
  const trace = process.env.AXIOM_FAKE_TRACE;
  const temp = process.env.TMPDIR;
  if (!trace || !temp || path.dirname(path.resolve(trace)) !== path.resolve(temp)) {
    throw new Error('fake trace must be directly inside owned TMPDIR');
  }
  const fd = fs.openSync(trace, 'wx', 0o600);
  automatic = install({ http: require('node:http'), https: require('node:https') }, event => {
    const data = Buffer.from(JSON.stringify(event) + '\n');
    let offset = 0;
    while (offset < data.length) {
      const n = fs.writeSync(fd, data, offset, data.length - offset);
      if (n <= 0) throw new Error('short trace write');
      offset += n;
    }
  });
  process.once('exit', () => {
    try {
      fs.closeSync(fd);
      fs.writeFileSync(trace + '.status.json', JSON.stringify(automatic.status()) + '\n',
        { flag: 'wx', mode: 0o600 });
    } catch (_) {
      // Missing terminal file is a hard failure at the independent owner.
    }
  });
}
module.exports = { install, automaticStatus: () => automatic ? automatic.status() : null };
