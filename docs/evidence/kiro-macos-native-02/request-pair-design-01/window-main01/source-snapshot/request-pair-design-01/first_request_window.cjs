'use strict';
// Explicit installation only. First candidate construction window, NOT process terminal observation.
// Trusted ordinary Node/intrinsics. No application hooks and no automatic preload on import.
const frames = require('./candidate_frames.cjs');
const control = require('./control_frames.cjs');
const mux = require('./multiplex_reader.cjs');
const nodeAdapter = require('./node_http_adapter.cjs');
const undiciAdapter = require('./undici_adapter.cjs');
const { createSender } = require('./private_sender.cjs');
const defer = queueMicrotask;

function installWindow(endpoint, { deadlineMs = 15000 } = {}) {
  let state = 'installing', fault = 'none', windowClosed = false, closingScheduled = false;
  let sender = null, senderResult = null, setupFailed = false, settled = false;
  let observedCandidates = 0, reservedBytes = 0, reservedFrames = 0, peakQueuedFrames = 0;
  let channelReady = false, resolveReady, resolveDone;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const done = new Promise(resolve => { resolveDone = resolve; });
  const observers = [], queue = [];
  function snapshot() {
    return { schema: 'first-request-window-1', state, fault, windowClosed, channelReady,
      observedCandidates, reservedBytes, reservedFrames, queuedFrames: queue.length, peakQueuedFrames,
      observers: observers.map(({ source, observer }) => ({ source, status: observer.snapshot() })),
      channel: sender ? sender.snapshot() : null,
      observation: 'first-candidate-construction-window',
      naturalInstallationProved: false, laterRequestsCovered: false,
      requestCompletenessProved: false, ownerTerminationProved: false,
      authenticationParityProved: false, wireReceiptProved: false };
  }
  function maybeSettle() {
    if (settled || !windowClosed || !senderResult && !setupFailed) return;
    settled = true; queue.length = 0;
    resolveDone(snapshot());
  }
  function fail(reason) {
    if (fault === 'none') fault = reason;
    state = 'failed'; queue.length = 0;
    if (sender) sender.abort();
    scheduleClose();
  }
  function flush() {
    if (!sender || !sender.ready || fault !== 'none') return;
    while (queue.length && fault === 'none') {
      const item = queue.shift();
      let ok = false;
      try {
        ok = item.kind === 'candidate' ? sender.sendCandidate(item.value)
          : sender.sendStatus(item.source, item.value);
      } catch (_) { fail('channel-send-fault'); return; }
      if (!ok) { fail('channel-rejected'); return; }
    }
    if (windowClosed && fault === 'none' && !sender.finish()) fail('channel-finish-fault');
  }
  function enqueue(kind, source, value) {
    if (fault !== 'none') return false;
    const encoded = kind === 'candidate' ? frames.encode(value) : control.encodeStatus(source, value);
    if (!encoded || reservedFrames >= 5 || reservedBytes + encoded.length > mux.limits.bytes) {
      fail('queue-cap-or-schema'); return false;
    }
    reservedFrames++; reservedBytes += encoded.length;
    queue.push({ kind, source, value });
    peakQueuedFrames = Math.max(peakQueuedFrames, queue.length);
    // The immutable candidate strings stay only in this private RAM queue until ready.
    flush();
    return fault === 'none';
  }
  function scheduleClose() {
    if (closingScheduled || windowClosed) { maybeSettle(); return; }
    closingScheduled = true;
    defer(() => {
      for (const { source, observer } of observers) {
        try {
          const status = observer.close();
          if (status.state !== 'closed' || status.fault !== 'none' || status.pending !== 0) fail('observer-close-fault');
          if (fault === 'none') enqueue('status', source, status);
        } catch (_) { fail('observer-close-fault'); }
      }
      windowClosed = true;
      if (fault === 'none') state = 'window-closed';
      flush(); maybeSettle();
    });
  }
  function onCandidate(packet) {
    if (fault !== 'none') return;
    observedCandidates++;
    if (state !== 'active' || windowClosed || observedCandidates !== 1) { fail('candidate-count-or-state'); return; }
    if (enqueue('candidate', null, packet)) scheduleClose();
  }
  try {
    for (const [source, adapter] of [['node-http', nodeAdapter], ['undici', undiciAdapter]]) {
      const observer = adapter.install(onCandidate, () => fail('observer-fault'));
      observers.push({ source, observer });
      const status = observer.snapshot();
      if (status.state !== 'active' || status.fault !== 'none') { fail('observer-install-fault'); break; }
      if (!enqueue('status', source, status)) break;
    }
    if (fault === 'none') state = 'active';
  } catch (_) { fail('observer-install-fault'); }
  // createSender runs its endpoint checks/connect synchronously, then awaits ready.
  // The observers above are already installed when installWindow returns to the app.
  createSender(endpoint, { deadlineMs }).then(value => {
    sender = value; channelReady = value.ready; resolveReady(value.ready);
    value.done.then(result => {
      senderResult = result;
      if (result.state !== 'closed' || result.fault !== 'none') fail('channel-failed');
      if (!windowClosed) fail('channel-closed-before-window');
      maybeSettle();
    }, () => { setupFailed = true; fail('channel-done-fault'); });
    if (fault !== 'none') value.abort();
    else if (!value.ready) fail('channel-not-ready');
    else flush();
  }, () => {
    setupFailed = true; resolveReady(false); fail('channel-setup-fault');
  });
  return Object.freeze({ ready, done, snapshot, abort: () => fail('owner-aborted') });
}
module.exports = Object.freeze({ installWindow });
