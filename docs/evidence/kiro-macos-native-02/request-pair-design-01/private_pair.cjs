'use strict';
// Own-directory Unix sockets; explicit construction only. Never persist candidates.
// This is a transport/component result, NOT natural-sender or owner attestation.
const fs = require('node:fs');
const net = require('node:net');
const { Buffer } = require('node:buffer');
const mux = require('./multiplex_reader.cjs');
const { compareRequestBodies } = require('./body_pair.cjs');
const SOURCES = ['node-http', 'undici'];

async function createPair({ deadlineMs = 15000 } = {}) {
  if (!Number.isInteger(deadlineMs) || deadlineMs < 100 || deadlineMs > 60000) throw new Error('pair-options');
  const directory = fs.mkdtempSync('/private/tmp/kiro-pair-');
  fs.chmodSync(directory, 0o700);
  const dirStat = fs.lstatSync(directory);
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink() || (dirStat.mode & 0o777) !== 0o700
      || dirStat.uid !== process.getuid()) throw new Error('pair-directory');
  const slots = ['left', 'right'].map(name => ({ name, path: directory + '/' + name + '.sock',
    server: null, serverDone: null, socket: null, reader: null, accepted: 0, bytes: 0, eof: false, closed: false,
    candidate: null, counts: [0, 0], statuses: [null, null], active: [false, false] }));
  let state = 'listening', fault = 'none', settled = false, timer, comparison = null;
  let resolveResult;
  const result = new Promise(resolve => { resolveResult = resolve; });
  function report() {
    return { schema: 'private-pair-channel-1', state, fault,
      sides: slots.map(slot => ({ role: slot.name, acceptedConnections: slot.accepted,
        acceptedBytes: slot.bytes, readableEOF: slot.eof, socketClosed: slot.closed,
        candidates: slot.counts.reduce((a, b) => a + b, 0),
        observerStates: slot.statuses.map(s => s ? s.state : 'unknown'),
        reader: slot.reader ? slot.reader.snapshot() : null })),
      comparison, observation: 'private-channel-candidate-values',
      peerIdentityProved: false, naturalInstallationProved: false,
      requestCompletenessProved: false, ownerTerminationProved: false,
      authenticationParityProved: false, wireReceiptProved: false };
  }
  function release() { for (const slot of slots) slot.candidate = null; }
  function stopIO() {
    for (const slot of slots) {
      try { slot.socket?.destroy(); } catch (_) { /* Fixed state only. */ }
      try { slot.server?.close(); } catch (_) { /* Own server only. */ }
    }
  }
  function settle() {
    if (settled) return;
    settled = true; clearTimeout(timer); release(); stopIO(); resolveResult(report());
  }
  function fail(reason) {
    if (fault !== 'none') return;
    fault = reason; state = 'failed'; comparison = null;
    release(); stopIO(); settle();
  }
  function recordCandidate(slot, packet) {
    if (settled || slot.candidate !== null) { fail('candidate-count'); return; }
    const index = packet.headerBoundary === 'node-http1-header-cache' ? 0 : 1;
    if (!slot.active[index] || slot.statuses[index]?.state !== 'active') { fail('candidate-order'); return; }
    slot.counts[index]++; slot.candidate = packet;
  }
  function recordControl(slot, value) {
    if (settled) { fail('late-control'); return; }
    const index = SOURCES.indexOf(value.source);
    if (index < 0 || value.faultPresent) { fail('observer-fault'); return; }
    if (value.schema !== 'observer-status-frame-1' || !['active', 'closed'].includes(value.state)) {
      fail('observer-state'); return;
    }
    const previous = slot.statuses[index];
    if (!previous && value.state !== 'active' || previous?.state === 'closed'
        || value.pending !== 0 || previous && ['calls', 'records', 'candidates', 'submitted']
          .some(key => value[key] < previous[key])) { fail('status-order'); return; }
    if (value.state === 'active') slot.active[index] = true;
    if (value.state === 'closed' && (value.submitted !== slot.counts[index]
        || value.candidates !== value.submitted)) { fail('status-count'); return; }
    slot.statuses[index] = value;
  }
  function maybeCompare() {
    if (settled || !slots.every(slot => slot.eof)) return;
    if (slots.some(slot => !slot.candidate || slot.statuses.some(s => s?.state !== 'closed'))) {
      fail('incomplete-observation'); return;
    }
    try {
      const [a, b] = slots.map(slot => slot.candidate);
      comparison = { body: compareRequestBodies(a.body, b.body),
        originalHeaderTextEqual: a.header === b.header,
        sameHeaderBoundary: a.headerBoundary === b.headerBoundary,
        headerBoundaries: [a.headerBoundary, b.headerBoundary],
        bodyBoundaries: [a.bodyBoundary, b.bodyBoundary],
        headerEqualityIsOnlySuppliedText: true, authenticationScope: 'unknown' };
      state = 'candidate-pair'; settle();
    } catch (_) { fail('comparison-fault'); }
  }
  function accept(slot, socket) {
    slot.accepted++;
    socket.on('error', () => fail('socket-error'));
    if (slot.accepted !== 1 || settled) { socket.destroy(); fail('unexpected-connection'); return; }
    slot.socket = socket;
    // Keep server listening to detect duplicate connections until settlement.
    slot.reader = mux.createReader(packet => recordCandidate(slot, packet),
      value => recordControl(slot, value), () => fail('stream-fault'));
    socket.on('readable', () => {
      try {
        while (!settled && socket.readableLength > 0) {
          const remaining = mux.limits.bytes - slot.bytes;
          if (remaining <= 0) { fail('receive-cap'); return; }
          // Bounded application read. Node/kernel buffers can contain more bytes.
          const bytes = socket.read(Math.min(65536, remaining, socket.readableLength));
          if (!bytes) break;
          slot.bytes += bytes.length;
          if (!slot.reader.push(bytes)) { fail('stream-fault'); return; }
        }
      } catch (_) { fail('receive-fault'); }
    });
    socket.on('end', () => {
      if (settled) return;
      slot.eof = true;
      const snapshot = slot.reader.finish();
      if (snapshot.fault !== 'none') { fail('stream-fault'); return; }
      socket.end(); maybeCompare();
    });
    socket.on('close', () => {
      slot.closed = true;
      if (!slot.eof && !settled) fail('premature-close');
    });
  }
  timer = setTimeout(() => fail('deadline'), deadlineMs);
  const listening = await Promise.all(slots.map(slot => new Promise(resolve => {
    let done = false;
    const finish = value => { if (!done) { done = true; resolve(value); } };
    const server = slot.server = net.createServer({ allowHalfOpen: true, pauseOnConnect: true }, socket => accept(slot, socket));
    server.maxConnections = 2;
    server.on('error', () => { finish(false); fail('listen-error'); });
    slot.serverDone = new Promise(resolveClosed => server.once('close', () => { finish(false); resolveClosed(); }));
    try {
      server.listen(slot.path, () => {
        try { fs.chmodSync(slot.path, 0o600); finish(true); }
        catch (_) { finish(false); fail('socket-permissions'); }
      });
    } catch (_) { finish(false); fail('listen-error'); }
  })));
  if (!listening.every(Boolean) && !settled) fail('listen-error');
  async function dispose() {
    if (!settled) fail('owner-disposed');
    stopIO(); await Promise.all(slots.map(slot => slot.serverDone));
    let cleaned = true;
    try {
      const now = fs.lstatSync(directory);
      if (now.dev !== dirStat.dev || now.ino !== dirStat.ino) return { ownDirectoryRemoved: false };
      // Never recursively remove or unlink unknown files, even inside the owned dir.
      fs.rmdirSync(directory);
    } catch (_) { cleaned = false; }
    return { ownDirectoryRemoved: cleaned };
  }
  return Object.freeze({ endpoints: Object.freeze({ left: slots[0].path, right: slots[1].path }),
    ready: listening.every(Boolean) && !settled, result, snapshot: report,
    abort: () => fail('owner-aborted'), dispose });
}
module.exports = Object.freeze({ createPair });
