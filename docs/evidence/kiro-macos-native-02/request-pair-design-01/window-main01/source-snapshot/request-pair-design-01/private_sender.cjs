'use strict';
// Explicit own Unix channel, no automatic observer install and no HTTP send.
const fs = require('node:fs');
const net = require('node:net');
const frames = require('./candidate_frames.cjs');
const control = require('./control_frames.cjs');
const mux = require('./multiplex_reader.cjs');
const nodeAdapter = require('./node_http_adapter.cjs');
const undiciAdapter = require('./undici_adapter.cjs');
async function createSender(endpoint, { deadlineMs = 15000 } = {}) {
  if (typeof endpoint !== 'string' || !/^\/private\/tmp\/kiro-pair-[A-Za-z0-9]{6}\/(left|right)\.sock$/.test(endpoint)
      || !Number.isInteger(deadlineMs) || deadlineMs < 100 || deadlineMs > 60000) throw new Error('sender-options');
  const directory = endpoint.slice(0, endpoint.lastIndexOf('/'));
  let ds, ss;
  try { ds = fs.lstatSync(directory); ss = fs.lstatSync(endpoint); }
  catch (_) { throw new Error('sender-endpoint'); }
  if (!ds.isDirectory() || ds.isSymbolicLink() || ds.uid !== process.getuid() || (ds.mode & 0o777) !== 0o700
      || !ss.isSocket() || ss.uid !== process.getuid() || (ss.mode & 0o777) !== 0o600) throw new Error('sender-endpoint');
  let state = 'connecting', fault = 'none', bytes = 0, candidates = 0, controls = 0;
  let connected = false, writeFinished = false, readEOF = false, socketClosed = false;
  let adapters = null, installing = false, resolveReady, resolveDone;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const done = new Promise(resolve => { resolveDone = resolve; });
  const socket = new net.Socket({ allowHalfOpen: true });
  function snapshot() {
    return { schema: 'private-sender-1', state, fault, connected, writeFinished, readEOF, socketClosed,
      acceptedBytes: bytes, candidates, controls,
      observerStatuses: adapters ? adapters.map(a => a.observer.snapshot()) : null,
      peerIdentityProved: false, naturalInstallationProved: false,
      requestCompletenessProved: false, ownerTerminationProved: false, wireReceiptProved: false };
  }
  function fail(reason) {
    if (fault === 'none') fault = reason;
    state = 'failed';
    // Original request APIs still run; this private observation channel alone is destroyed.
    socket.destroy(); resolveReady(false);
  }
  function send(frame, candidate) {
    if (state !== 'open') { fail('late-send'); return false; }
    if (!frame) { fail('invalid-frame'); return false; }
    if (candidate ? candidates >= 4 : controls >= 32) { fail('frame-cap'); return false; }
    if (bytes + frame.length > mux.limits.bytes) { fail('send-cap'); return false; }
    bytes += frame.length;
    if (candidate) candidates++; else controls++;
    try {
      // write(false) is backpressure, not loss. Total lifetime queued bytes bounded above.
      socket.write(frame);
      return true;
    } catch (_) { fail('send-fault'); return false; }
  }
  const sendCandidate = packet => send(frames.encode(packet), true);
  const sendStatus = (source, snapshot) => send(control.encodeStatus(source, snapshot), false);
  function notifyFault(source) {
    if (state !== 'open') { fail('late-observer-fault'); return false; }
    // Deliver the fixed fault frame before ending; no fault reason or exception is serialized.
    const sent = send(control.encodeFault(source), false);
    if (sent) { fault = 'observer-fault'; finish(); }
    return sent;
  }
  function installObservers() {
    if (state !== 'open' || adapters || installing) { fail('install-state'); return false; }
    installing = true; adapters = [];
    try {
      for (const [source, adapter] of [['node-http', nodeAdapter], ['undici', undiciAdapter]]) {
        const observer = adapter.install(sendCandidate, () => notifyFault(source));
        adapters.push({ source, observer });
        if (!sendStatus(source, observer.snapshot())) return false;
      }
      return fault === 'none';
    } catch (_) { fail('install-fault'); return false; }
    finally { installing = false; }
  }
  function closeObservers() {
    if (!adapters) return;
    for (const { source, observer } of adapters) {
      try { const status = observer.close(); if (state === 'open') sendStatus(source, status); }
      catch (_) { fail('close-observer-fault'); }
    }
  }
  function finish() {
    if (state !== 'open') return false;
    state = 'ending';
    try { socket.end(); return true; }
    catch (_) { fail('end-fault'); return false; }
  }
  const timer = setTimeout(() => fail('deadline'), deadlineMs);
  socket.on('error', () => fail('socket-error'));
  socket.on('connect', () => { connected = true; state = 'open'; resolveReady(true); });
  socket.on('data', () => fail('unexpected-reply'));
  socket.on('finish', () => { writeFinished = true; });
  socket.on('end', () => {
    readEOF = true;
    if (state === 'open') fail('premature-peer-eof');
  });
  socket.on('close', () => {
    socketClosed = true; clearTimeout(timer); resolveReady(false);
    if (fault === 'none') {
      if (!writeFinished || !readEOF) { fault = 'premature-close'; state = 'failed'; }
      else state = 'closed';
    } else state = 'failed';
    closeObservers();
    resolveDone(snapshot());
  });
  try { socket.connect(endpoint); } catch (_) { fail('connect-fault'); }
  const isReady = await ready;
  return Object.freeze({ ready: isReady, sendCandidate, sendStatus, notifyFault,
    installObservers, closeObservers, finish, done, snapshot,
    abort: () => fail('owner-aborted') });
}
module.exports = Object.freeze({ createSender });
