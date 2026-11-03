'use strict';
// Only a self-owned HTTP test. Never load into the official process or production.
const http = require('node:http');
const { Buffer } = require('node:buffer');
const observer = require('/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02/observer-real-auth-01/end_string_observer.cjs');
const SECRET = 'SYNTHETIC_HTTP02_x7mQ9p_CANARY';
const proto = http.ClientRequest.prototype;
const own = Object.getOwnPropertyDescriptor;
const oldEnd = own(proto, 'end');
const oldWrite = own(proto, 'write');
const getAlias = http.get;
const requestAlias = http.request;
let effectiveEnd;
let originalEnd;
let originalWrite;
let spyDescriptor;
let server;
let session = null;
let awaiting = null;
let spyCalls = [];
const sockets = new Set();
const clients = new Set();
let phase = 'setup';
let index = -1;
let assertions = 0;
let started = 0;
let received = 0;
let responses = 0;
let responseEnds = 0;
let port = null;
let closed = false;
let restored = false;
let observerState = 'not-installed';
let observerFault = 'none';
const pairs = [];
function check(ok) { assertions += 1; if (!ok) throw null; }
function sameDescriptor(a, b) {
  if (!a || !b) return a === b;
  return ['value', 'get', 'set', 'writable', 'enumerable', 'configurable'].every(k => a[k] === b[k]);
}
function lookup(p, key) {
  for (let i = 0; p && i < 5; i += 1, p = Object.getPrototypeOf(p)) {
    const d = own(p, key);
    if (d) return d;
  }
  return undefined;
}
function spy() {
  const record = { receiver: this, args: Array.from(arguments) };
  spyCalls.push(record);
  const result = Reflect.apply(originalEnd, this, arguments);
  record.result = result;
  return result;
}
function leakFree(value) {
  const text = JSON.stringify(value);
  const b = Buffer.from(SECRET);
  const patterns = [SECRET, JSON.stringify(SECRET).slice(1, -1), b.toString('base64'),
    b.toString('hex'), b.toString('hex').toUpperCase(),
    [...SECRET].map(c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join(''),
    [...SECRET].map(c => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')];
  check(patterns.every(s => !text.includes(s)));
  return text;
}
function listeners(req) { return ['response', 'error', 'drain'].map(k => req.listenerCount(k)); }
function takeObserver() {
  if (!session) return null;
  const s = session.snapshot();
  observerState = s.state;
  observerFault = s.fault;
  leakFree(s);
  return s;
}
function restoreSpy() {
  if (session) { session.close(); takeObserver(); session = null; }
  if (oldEnd) Object.defineProperty(proto, 'end', oldEnd);
  else check(Reflect.deleteProperty(proto, 'end'));
  check(sameDescriptor(own(proto, 'end'), oldEnd));
  check(sameDescriptor(own(proto, 'write'), oldWrite));
  restored = true;
}
const scenarios = [
  ['default', 'primitive-utf8-argument', () => [SECRET + ' ASCII 雪🌊']],
  ['utf8', 'primitive-utf8-argument', () => [SECRET + ' 雪', 'utf8']],
  ['utf-8', 'primitive-utf8-argument', () => [SECRET + ' 雪', 'utf-8']],
  ['empty', 'primitive-utf8-argument', () => ['']],
  ['endnone', 'no-primitive-string', () => []],
  ['buffer', 'no-primitive-string', () => [Buffer.from(SECRET + ' buffer')]],
  ['write', 'write-seen', () => [SECRET + ' tail']],
  ['latin1', 'unsupported-encoding', () => [SECRET + ' é', 'latin1']],
  ['get', 'no-primitive-string', () => []],
  ['oversize', 'string-cap', () => [SECRET + 'x'.repeat(262145 - SECRET.length)]],
];
async function one(scenario) {
  const [id, , makeArgs] = scenario;
  const args = makeArgs();
  check(awaiting === null);
  let rejectAll;
  let receiveResolve;
  const receivedPromise = new Promise((resolve, reject) => {
    receiveResolve = resolve;
    rejectAll = reject;
  });
  let completeResolve;
  let completeReject;
  const completePromise = new Promise((resolve, reject) => {
    completeResolve = resolve; completeReject = reject;
  });
  // Attach rejection handlers to both immediately, before any synchronous API call.
  const both = Promise.all([receivedPromise, completePromise]);
  const reject = () => { rejectAll(null); completeReject(null); };
  awaiting = { resolve: receiveResolve, reject };
  const responseCallback = res => {
    responses += 1;
    res.once('error', reject);
    res.once('end', () => { responseEnds += 1; completeResolve(); });
    res.resume();
  };
  const options = { host: '127.0.0.1', port, agent: false,
    method: id === 'get' ? 'GET' : 'POST', path: '/v1/responses',
    headers: { 'X-Synthetic-Secret': SECRET, 'Content-Type': 'application/octet-stream' } };
  const begin = spyCalls.length;
  let req;
  let before = null;
  let after;
  let callbackCount = 0;
  const callback = () => { callbackCount += 1; };
  try {
    started += 1;
    if (id === 'get') req = getAlias(options, responseCallback);
    else req = requestAlias(options, responseCallback);
    clients.add(req);
    req.once('error', reject);
    req.once('close', () => clients.delete(req));
    if (id !== 'get') {
      before = listeners(req);
      if (id === 'write') req.write(SECRET + ' prefix');
      const supplied = id === 'endnone' ? [] : [...args, callback];
      const result = Reflect.apply(req.end, req, supplied);
      check(result === req);
      const call = spyCalls[spyCalls.length - 1];
      check(call.receiver === req && call.result === result && call.args.length === supplied.length);
      for (let i = 0; i < supplied.length; i += 1) check(call.args[i] === supplied[i]);
    }
    after = listeners(req);
  } catch (_) { reject(); }
  const [got] = await both;
  check(spyCalls.length - begin === 1);
  const call = spyCalls[spyCalls.length - 1];
  check(call.receiver === req && call.result === req);
  check(callbackCount === (id === 'endnone' || id === 'get' ? 0 : 1));
  const body = Buffer.isBuffer(args[0]) ? args[0] : Buffer.from(args[0] || '', args[1] || 'utf8');
  const expected = id === 'write' ? Buffer.concat([Buffer.from(SECRET + ' prefix'), body]) : body;
  check(got.body.equals(expected));
  return { got, before, after, callbackCount };
}
async function run() {
  effectiveEnd = lookup(proto, 'end');
  const effectiveWrite = lookup(proto, 'write');
  check(effectiveEnd && typeof effectiveEnd.value === 'function');
  check(effectiveWrite && typeof effectiveWrite.value === 'function');
  originalEnd = effectiveEnd.value;
  originalWrite = effectiveWrite.value;
  check(proto.end === originalEnd && proto.write === originalWrite);
  // Explicit configurable shadow, never spread an absent own descriptor.
  Object.defineProperty(proto, 'end', { value: spy, writable: true,
    enumerable: effectiveEnd.enumerable, configurable: true });
  spyDescriptor = own(proto, 'end');
  server = http.createServer((req, res) => {
    received += 1;
    const owner = awaiting;
    awaiting = null;
    if (!owner) { req.destroy(); res.destroy(); return; }
    const chunks = [];
    let size = 0;
    req.once('error', owner.reject);
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 262145) { owner.reject(); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.once('end', () => {
      try {
        const body = Buffer.concat(chunks);
        check(size === body.length);
        owner.resolve({ body, headers: req.rawHeaders.slice(), method: req.method,
          path: req.url, version: req.httpVersion });
        res.end();
      } catch (_) { owner.reject(); }
    });
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  phase = 'listen';
  await new Promise((resolve, reject) => {
    server.once('error', () => reject(null));
    server.listen(0, '127.0.0.1', resolve);
  });
  port = server.address().port;
  check(Number.isInteger(port) && port > 0 && port <= 65535);
  for (index = 0; index < scenarios.length; index += 1) {
    const scenario = scenarios[index];
    phase = 'control';
    check(proto.end === spy && proto.write === originalWrite);
    const control = await one(scenario);
    phase = 'install';
    session = observer.install();
    check(takeObserver().state === 'active');
    phase = 'observed';
    const observed = await one(scenario);
    phase = 'compare';
    check(control.got.body.equals(observed.got.body));
    for (const key of ['headers', 'method', 'path', 'version']) {
      check(JSON.stringify(control.got[key]) === JSON.stringify(observed.got[key]));
    }
    check(JSON.stringify(control.before) === JSON.stringify(observed.before));
    check(JSON.stringify(control.after) === JSON.stringify(observed.after));
    check(control.callbackCount === observed.callbackCount);
    const s = takeObserver();
    check(s.fault === 'none' && s.pending === 0 && s.records.length === 1);
    check(s.records[0].body === scenario[1] && s.records[0].endReturned === true);
    check(s.calls === (scenario[0] === 'write' ? 2 : 1));
    check(s.requestCompletenessProved === false && s.wireReceiptProved === false
      && s.naturalInstallationProved === false);
    phase = 'close-observer';
    session.close();
    check(takeObserver().state === 'closed' && observerFault === 'none');
    session = null;
    check(sameDescriptor(own(proto, 'end'), spyDescriptor));
    check(sameDescriptor(own(proto, 'write'), oldWrite));
    pairs.push({ case: scenario[0], body: scenario[1], exactReceipt: true,
      exactHeaders: true, callbacksAndReturns: true, listenersUnchanged: true });
    spyCalls = [];
  }
  phase = 'complete';
  check(started === 20 && received === 20 && responses === 20 && responseEnds === 20);
}
(async () => {
  let success = false;
  let failedPhase = null;
  try { await run(); success = true; }
  catch (_) { failedPhase = phase; }
  try { restoreSpy(); } catch (_) { success = false; if (!failedPhase) failedPhase = 'restore'; }
  try {
    if (server && server.listening) {
      // Failure cleanup acts only on this fixture's own sockets/clients.
      if (!success) { for (const req of clients) req.destroy(); for (const s of sockets) s.destroy(); }
      await new Promise(resolve => server.close(() => { closed = true; resolve(); }));
    }
  } catch (_) { success = false; if (!failedPhase) failedPhase = 'server-close'; }
  if (!closed || !restored) success = false;
  const terminal = { schema: 'http02-fixture-1', outcome: success ? 'PASS' : 'FAIL',
    failedPhase, caseIndex: Math.min(index, 10), assertions,
    pid: process.pid, runtime: { version: process.version, platform: process.platform, arch: process.arch },
    port, clientStarted: started, serverRequests: received, responses, responseEnds,
    originalEndOwn: oldEnd !== undefined, originalWriteOwn: oldWrite !== undefined,
    observerState, observerFault, serverClosed: closed, restored,
    pairs, httpsTested: false, parityProved: false };
  let text;
  try { text = leakFree(terminal); check(Buffer.byteLength(text) <= 12288); }
  catch (_) { text = '{"schema":"http02-fixture-1","outcome":"FAIL","reason":"terminal-privacy-or-cap"}'; success = false; }
  process.stdout.write(text + '\n');
  process.exitCode = success ? 0 : 1;
})().catch(() => {
  process.stdout.write('{"schema":"http02-fixture-1","outcome":"FAIL","reason":"fixed-finalization"}\n');
  process.exitCode = 1;
});
