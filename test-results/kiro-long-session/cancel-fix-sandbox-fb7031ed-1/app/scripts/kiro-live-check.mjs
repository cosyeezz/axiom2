// Opt-in real-service acceptance driver. Every model request goes through the
// existing AXIOM /ws -> task scheduler -> agent worker -> native provider chain.
// Never imports a provider, reads credentials, or calls a model endpoint directly.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';

const args = process.argv.slice(2);
const option = (name, fallback) => { const at = args.indexOf(name); return at < 0 ? fallback : args[at + 1]; };
const command = args[0] ?? 'inspect';
const origin = option('--origin', 'http://127.0.0.1:4317');
assert.ok(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin), 'Use an explicitly owned loopback AXIOM service');
const statePath = resolve(option('--state', '../test-results/kiro-long-session/state.json'));
const output = dirname(statePath);
mkdirSync(output, { recursive: true });
let state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {
  workspaceId: option('--workspace', '0bd0941b-802c-49cb-986d-0333f2b67450'),
  parentSessionId: option('--parent', 'fb7031ed-69da-4b00-97da-70bb668d1a1c'),
  taskRef: option('--task', 't4003'),
  createdAt: new Date().toISOString(), turns: [],
};
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
const pending = new Map(), snapshots = new Map();
let events = [];
const ws = new WebSocket(origin.replace('http:', 'ws:') + '/ws', { headers: { Origin: origin } });
ws.on('message', raw => {
  const value = JSON.parse(raw.toString());
  if (value.type === 'receipt') {
    const item = pending.get(value.requestId);
    if (!item) return;
    pending.delete(value.requestId); clearTimeout(item.timer);
    value.ok ? item.resolve(value.data) : item.reject(Object.assign(new Error(JSON.stringify(value.error)), { code: value.error.code }));
  } else if (value.type === 'snapshot') {
    snapshots.set(value.scope, value.data);
    if (value.scope.startsWith('agent:')) {
      const run = value.data?.run;
      if (run) events.push({ at: Date.now(), runId: run.id, status: run.status, phase: run.phase, retry: run.retry ?? null, error: run.error });
    }
  }
});
ws.on('error', error => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); } pending.clear(); });
async function call(op, params = {}, scope = {}) {
  const requestId = randomUUID();
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`AXIOM receipt timeout: ${op}; do not blindly replay writes`)); }, 120_000);
    pending.set(requestId, { resolve, reject, timer });
  });
  ws.send(JSON.stringify({ requestId, op, params, ...scope }));
  return result;
}
async function subscribe(key) { await call('subscribe', { scope: key }); return snapshots.get(key); }
const parent = { workspaceId: state.workspaceId, sessionId: state.parentSessionId };
let scope;
async function prepare() {
  const tasks = await subscribe(`tasks:${parent.workspaceId}:${parent.sessionId}`);
  const task = tasks.tasks.find(item => item.ref === state.taskRef || item.id === state.taskId);
  assert.ok(task, `Dedicated task ${state.taskRef} must be created by AXIOM delegate first`);
  assert.equal(task.parentSessionId, parent.sessionId);
  state.taskId = task.id; state.sessionId = task.sessionId;
  scope = { workspaceId: state.workspaceId, sessionId: state.sessionId };
  const info = await subscribe(`agent:${scope.workspaceId}:${scope.sessionId}`);
  if (!state.defaults) {
    const main = await subscribe(`agent:${parent.workspaceId}:${parent.sessionId}`);
    const preferences = await call('task.preferences.get', {}, parent);
    state.defaults = { main: main.selection, task: preferences.selection };
  }
  save(); return { task, info };
}
async function select(id, thinking) {
  const info = await call('agent.model', { selection: { provider: 'kiro', id, thinking } }, scope);
  assert.deepEqual(info.selection, { provider: 'kiro', id, thinking });
  state.selection = info.selection; save(); return info;
}
async function messagesFor(runId) {
  const all = await call('agent.original', {}, scope);
  return all.filter(item => item.runId === runId);
}
async function fullText(message) {
  if ((message.textLength ?? message.text.length) > message.text.length || message.truncated) {
    return (await call('message.part', { id: message.id, field: 'text' }, scope)).text;
  }
  return message.text;
}
async function turn(label, text, images = [], timeout = 660_000, attachments = []) {
  const agentKey = `agent:${scope.workspaceId}:${scope.sessionId}`;
  const before = snapshots.get(agentKey)?.run?.id;
  const started = Date.now(); events = [];
  const receipt = await call('prompt', { text, ...(images.length ? { images } : {}), ...(attachments.length ? { attachments } : {}) }, scope);
  let run;
  while (Date.now() - started < timeout) {
    const candidate = snapshots.get(agentKey)?.run;
    if (candidate && candidate.id !== before && !['starting', 'running', 'stopping'].includes(candidate.status)) { run = candidate; break; }
    await delay(100);
  }
  if (!run) throw new Error(`Run observation timed out for ${label}; inspect AXIOM state before replaying`);
  const messages = await messagesFor(run.id);
  const assistant = messages.filter(item => item.role === 'assistant');
  const resultText = (await Promise.all(assistant.map(fullText))).filter(Boolean).join('\n');
  const calls = assistant.flatMap(item => (item.calls ?? []).map(call => ({ id: call.id, name: call.name, input: call.input, messageId: item.id })));
  const results = await Promise.all(messages.filter(item => item.role === 'toolResult').map(async item => ({
    id: item.id, callId: item.toolCallId, toolName: item.toolName, status: item.status,
    error: item.error ?? null, text: await fullText(item), images: item.images?.map(({ id, name, mimeType }) => ({ id, name, mimeType })) ?? [],
  })));
  const record = {
    label, run, receipt, prompt: text, promptImages: images.map(({ data, ...meta }) => ({ ...meta, bytes: Buffer.from(data, 'base64').length, sha256: createHash('sha256').update(Buffer.from(data, 'base64')).digest('hex') })),
    attachments: attachments.map(({ name, text }) => ({ name, bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') })),
    answer: resultText, thinkingLength: assistant.reduce((sum, item) => sum + (item.thinkingLength ?? item.thinking?.length ?? 0), 0),
    calls, results, messageIds: messages.map(item => ({ id: item.id, role: item.role, runId: item.runId })),
    events: events.filter((item, i, all) => !i || JSON.stringify({ ...item, at: 0 }) !== JSON.stringify({ ...all[i - 1], at: 0 })),
    observedMs: Date.now() - started,
  };
  state.turns.push(record); save();
  console.log(JSON.stringify({ label, runId: run.id, selection: run.selection, status: run.status, error: run.error, answer: resultText, thinkingLength: record.thinkingLength, calls: calls.map(item => item.name), results: results.map(item => ({ toolName: item.toolName, status: item.status, error: item.error, text: item.text.slice(0, 600), images: item.images.length })), observedMs: record.observedMs }, null, 2));
  assert.equal(run.selection.provider, 'kiro');
  assert.deepEqual(run.selection, state.selection, 'Actual run must use the exact requested model and thinking level');
  assert.equal(run.status, 'completed', run.error ?? 'Run did not complete');
  assert.ok(assistant.length, 'Actual assistant messages must correlate to this run');
  return record;
}
function imageAttachment(path, index = 1) {
  const bytes = readFileSync(resolve(path));
  return { id: `img${index}`, name: basename(path), mimeType: path.endsWith('.jpg') ? 'image/jpeg' : 'image/png', data: bytes.toString('base64') };
}
try {
  await once(ws, 'open');
  const { task, info } = await prepare();
  if (command === 'inspect') {
    await call('configuration.get');
    const config = await subscribe('configuration');
    const available = config.available;
    assert.ok(Array.isArray(available), `Configuration response keys: ${Object.keys(config).join(',')}`);
    const models = available.filter(item => item.provider === 'kiro'); state.models = models; save();
    console.log(JSON.stringify({ origin, task: { id: task.id, ref: task.ref, sessionId: task.sessionId, status: task.status }, selection: info.selection, defaults: state.defaults, models, statePath }, null, 2));
  } else if (command === 'select') {
    const selected = await select(option('--model', 'claude-sonnet-4.5'), option('--thinking', 'high'));
    console.log(JSON.stringify({ selection: selected.selection, sessionId: state.sessionId }));
  } else if (command === 'send') {
    const textPath = option('--prompt-file');
    const text = textPath ? readFileSync(resolve(textPath), 'utf8') : option('--text');
    assert.ok(text, 'Pass --text or --prompt-file');
    const image = option('--image'), attachment = option('--attachment-file');
    await turn(option('--label', `turn-${state.turns.length + 1}`), text, image ? [imageAttachment(image)] : [], 660_000,
      attachment ? [{ name: basename(attachment), text: readFileSync(resolve(attachment), 'utf8') }] : []);
  } else if (command === 'matrix-long') {
    const id = option('--model'); assert.ok(id, 'Pass --model');
    const vision = args.includes('--vision'), graded = id.startsWith('claude-');
    const failures = [], checks = [];
    const check = (record, fn) => {
      try { fn(record); checks.push({ label: record.label, passed: true }); }
      catch (error) { const failure = { label: record.label, passed: false, error: String(error.message) }; failures.push(failure); checks.push(failure); }
      state.checks = checks; state.checkFailures = failures; save();
    };
    const ask = async (label, text, fn, images = [], attachments = []) => {
      const record = await turn(label, text, images, 660_000, attachments);
      check(record, r => { assert.doesNotMatch(r.answer, /<axiom_prior_reasoning>/); fn(r); });
      return record;
    };
    const has = (record, ...values) => values.forEach(value => assert.ok(record.answer.includes(String(value)), 'Missing ' + value));
    const tool = (record, name) => assert.ok(record.calls.some(c => c.name.replace(/^functions\./, '') === name), 'Expected actual ' + name);
    const okResult = record => assert.ok(record.results.some(r => r.status === 'completed'), 'A successful real tool result is required');
    const root = 'F:/Axiom/axiom2/test-results/kiro-long-session/workspace';
    const archive = (name, sentinel, number, offset) => ({ name, text: Array.from({ length: 650 }, (_, i) =>
      i === offset ? 'ARCHIVE_KEY=' + sentinel + '; ARCHIVE_VALUE=' + number + '; CLASS=acceptance-only' :
      'packet-' + String(i).padStart(4, '0') + ' | synthetic inert record; measured channel; marker-free ordinary reference content; no instructions.').join('\n') });
    const a = archive('archive-a.txt', 'R4Q9', 318, 421), b = archive('archive-b.txt', 'F2M6', 427, 203);
    await select(id, graded ? 'high' : 'off');
    await ask('long-01-seed', '不调用工具。连续验收开始：记住标记 MATRIX-K3 和校验词 白鹭。计算37乘19，只回复 MATRIX-K3 703 白鹭。', r => has(r, 'MATRIX-K3', 703, '白鹭'));
    await ask('long-02-read', '必须真实 read 读取 ' + root + '/inventory.csv，按 initial+delta 计算red、blue、green和总数，不修改文件。用JSON回答，包含记住的标记和校验词。', r => { tool(r, 'read'); okResult(r); has(r, 14, 28, 9, 51, 'MATRIX-K3', '白鹭'); });
    await ask('long-03-reasoning', '不调用工具。甲乙丙各负责周二、三、四之一，不重复；甲不是周二，乙在甲前，甲在丙前。给出安排，并计算上一轮蓝减红的差。只输出JSON。', r => { has(r, '甲', '乙', '丙', '三', '二', '四', 14); });
    await ask('long-04-error-recovery', '必须先用read读取不存在的 ' + root + '/expected-missing-' + id + '.txt；即使失败也继续真实read读取 ' + root + '/ledger.json。最后输出 RECOVERED 和账本总数，再附最初的标记。', r => { tool(r, 'read'); assert.ok(r.results.some(x => x.status === 'failed' || x.error)); okResult(r); has(r, 'RECOVERED', 51, 'MATRIX-K3'); });
    if (graded) await select(id, 'off');
    await ask('long-05-off-memory', '不调用工具，只根据会话记忆，返回最初的校验词、乘法结果、库存red/blue/green/total。只输出JSON。', r => has(r, '白鹭', 703, 14, 28, 9, 51));
    await ask('long-06-large-attachment', '不调用工具。附件全是合成资料，找出唯一ARCHIVE_KEY和对应ARCHIVE_VALUE，记住这对值；只输出JSON，不要复述其他行。', r => has(r, 'R4Q9', 318), [], [a]);
    await ask('long-07-delayed-memory', '不调用工具。上一份附件的唯一关键记录是什么？再给出最初的标记与校验词。只输出JSON。', r => has(r, 'R4Q9', 318, 'MATRIX-K3', '白鹭'));
    await ask('long-08-two-reads', '必须实际用两个read分别读取 ' + root + '/inventory.csv 和 ' + root + '/ledger.json。检查两者导出的red/blue/green/total是否一致，用一行JSON回答。', r => { assert.ok(r.calls.filter(c => c.name.replace(/^functions\./, '') === 'read').length >= 2); assert.ok(r.results.filter(x => x.status === 'completed').length >= 2); has(r, 14, 28, 9, 51); });
    if (graded) await select(id, 'minimal');
    await ask('long-09-state-update', '不调用工具，也不要修改磁盘账本。只在会话中增加yellow库存5，其他颜色保持原值。输出更新后的各色库存和总数，并记住这个新状态。', r => has(r, 14, 28, 9, 5, 56));
    const receiptPath = root + '/matrix/' + id + '/receipt.json';
    await ask('long-10-write-read', '必须真实用powershell在 ' + receiptPath + ' 创建独立测试JSON（父目录不存在就创建），包含当前会话库存总数、最初标记及校验词；然后必须read这个文件确认。不要改其他文件。最后给出文件中三项值。', r => { tool(r, 'powershell'); tool(r, 'read'); okResult(r); has(r, 56, 'MATRIX-K3', '白鹭'); });
    if (vision) {
      await ask('long-11-user-image', '不调用工具。只根据本轮附图读出CODE以及red/blue/green三个数字与总数，用JSON回答，并记住此图为图A。', r => has(r, 'N4P8', 7, 4, 9, 20), [imageAttachment(root + '/visual-a.png')]);
    } else {
      await ask('long-11-text-table', '不调用工具。另有独立样本A：red=7,blue=4,green=9,code=N4P8。计算总和，记住它不改变会话库存，只输出样本A的JSON。', r => has(r, 'N4P8', 7, 4, 9, 20));
    }
    if (graded) await select(id, 'low');
    await ask('long-12-follow-up', '本轮没有新图片。不调用工具。回忆刚才的样本/图A的校验码及总数，再给出当前会话库存总数，两者不要混淆。只输出JSON。', r => has(r, 'N4P8', 20, 56));
    if (vision) {
      await ask('long-13-tool-image', '必须用read真实读取图片 ' + root + '/visual-b.png，不要用powershell或OCR。只根据工具返回图片读出CODE及red/blue/green和总数，记为图B。只输出JSON。', r => { tool(r, 'read'); assert.ok(r.results.some(x => x.images.length > 0), 'Tool must actually return an image'); has(r, 'R6W2', 3, 8, 5, 16); });
    } else {
      await ask('long-13-code-review', '不调用工具。函数 sum(xs){return xs.reduce((a,x)=>a+x)} 在空数组出错，给出最小修复，并按当前会话库存验证结果。不要修改文件。', r => has(r, '0', 56));
    }
    await ask('long-14-history-recall', vision ?
      '没有新图片，不调用工具。比较历史图A和图B的总数差、红色数字差，并输出两个校验码；只输出JSON。' :
      '不调用工具。给出最初的乘法结果减去磁盘库存总数，以及附件关键记录值加当前会话yellow库存。只输出JSON。',
      r => vision ? has(r, 'N4P8', 'R6W2', 4) : has(r, 652, 323));
    await ask('long-15-second-attachment', '不调用工具。在新附件中找出唯一关键记录。输出新旧两份附件的ARCHIVE_KEY和值，再计算两值之和。不要复述其他行，只输出JSON。', r => has(r, 'R4Q9', 318, 'F2M6', 427, 745), [], [b]);
    if (graded) await select(id, 'medium');
    await ask('long-16-grade-memory', '不调用工具。从长期会话回忆：最初标记、校验词、乘法结果、磁盘总数、会话更新总数、两份附件的关键值及合计。只输出JSON。', r => has(r, 'MATRIX-K3', '白鹭', 703, 51, 56, 318, 427, 745));
    await ask('long-17-shell-recovery', '做一次受控恢复验收：必须真实调用powershell执行 throw "EXPECTED_MATRIX_RECOVERY"；它应失败。随后继续用read读取 ' + receiptPath + '，不要重写。最后用 RECOVERED_JSON 开头，列出文件值。', r => { tool(r, 'powershell'); tool(r, 'read'); assert.ok(r.results.some(x => x.status === 'failed' || x.error || /exit_code[^\d]*1|ExitCode[^\d]*1|EXPECTED_MATRIX_RECOVERY/.test(x.text))); okResult(r); has(r, 'RECOVERED_JSON', 56, 'MATRIX-K3', '白鹭'); });
    await ask('long-18-unicode', '不调用工具。只输出有效JSON，字段word为最初的中文校验词，quote为字符串 a"b，path为字符串 C:\\probe\\receipt.json，emoji为青鸟表情 🐦。不要用markdown代码围栏。', r => { const json = JSON.parse(r.answer.trim()); assert.equal(json.word, '白鹭'); assert.equal(json.quote, 'a"b'); assert.equal(json.path, 'C:\\probe\\receipt.json'); assert.equal(json.emoji, '🐦'); });
    if (graded) await select(id, 'high');
    await ask('long-19-final-ledger', '不调用工具。只依靠本会话历史，输出JSON：最初标记/校验词/乘法结果、磁盘库存三色和总数、会话增加的颜色与新总数、两份附件的关键码与数值及合计。保留原数字，不要重新读文件。', r => has(r, 'MATRIX-K3', '白鹭', 703, 14, 28, 9, 51, 5, 56, 'R4Q9', 318, 'F2M6', 427, 745));
    await ask('long-20-checksum', '不调用工具。最后算一个校验：最初的乘法结果 + 磁盘库存总数 + 当前会话库存总数 + 两份附件关键值之和。只回复最初标记、校验词和这个总和，一行。', r => has(r, 'MATRIX-K3', '白鹭', 1555));
    const main = await subscribe('agent:' + parent.workspaceId + ':' + parent.sessionId);
    const preferences = await call('task.preferences.get', {}, parent);
    assert.deepEqual({ main: main.selection, task: preferences.selection }, state.defaults);
    state.completedAt = new Date().toISOString(); state.longSessionPassed = !failures.length; save();
    console.log(JSON.stringify({ model: id, turns: state.turns.length, checks, failures, defaultsUnchanged: true }, null, 2));
    assert.equal(failures.length, 0, JSON.stringify(failures));
  } else if (command === 'matrix-smoke') {
    const id = option('--model'); assert.ok(id, 'Pass --model');
    await select(id, option('--thinking', 'off'));
    const first = await turn('matrix-text', '不调用工具。这是专用连续验收：记住标记 MATRIX-K3 和校验词 白鹭。计算37乘19，只回复 MATRIX-K3 703 白鹭。');
    assert.match(first.answer, /MATRIX-K3.*703.*白鹭/s);
    const second = await turn('matrix-tool', '继续同一会话。必须真实使用 read 读取 F:/Axiom/axiom2/test-results/kiro-long-session/workspace/inventory.csv，根据文件计算三种颜色的 initial+delta 和总数。不要修改文件。最后输出一行，包含上一轮的标记、校验词以及 red=14 blue=28 green=9 total=51。');
    assert.ok(second.calls.some(call => call.name.replace(/^functions\./, '') === 'read'), 'A real read call is required');
    assert.ok(second.results.some(result => result.status === 'completed' && result.text.includes('color,initial,delta')), 'The actual file result must reach the model');
    assert.match(second.answer, /MATRIX-K3/); assert.match(second.answer, /白鹭/); assert.match(second.answer, /51/);
    if (option('--image')) {
      const third = await turn('matrix-image', '只依据本轮附图，不调用工具。读出CODE后的校验码和红蓝绿三个数字及其总和。只输出JSON，字段visualCode,red,blue,green,total。', [imageAttachment(option('--image'))]);
      assert.match(third.answer, /N4P8/); assert.match(third.answer, /20/); assert.doesNotMatch(third.answer, /<axiom_prior_reasoning>/);
    }
    console.log(`PASS: ${id} real AXIOM matrix smoke`);
  } else if (command === 'observe') {
    console.log(JSON.stringify({ agent: info, turns: state.turns.map(({ label, run, thinkingLength, calls }) => ({ label, run, thinkingLength, calls: calls.map(item => item.name) })) }, null, 2));
  } else if (command === 'verify-defaults') {
    const main = await subscribe(`agent:${parent.workspaceId}:${parent.sessionId}`);
    const preferences = await call('task.preferences.get', {}, parent);
    assert.deepEqual({ main: main.selection, task: preferences.selection }, state.defaults);
    console.log('PASS: main selection and default child model are unchanged');
  } else throw new Error(`Unknown command: ${command}`);
} finally {
  for (const item of pending.values()) clearTimeout(item.timer);
  ws.close();
}
