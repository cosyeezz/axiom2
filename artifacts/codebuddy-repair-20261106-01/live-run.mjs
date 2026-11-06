// Formal UI only. Raw model context/responses remain in RAM and normal application history.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
const require = createRequire(resolve('app/package.json'));
const { chromium } = require('playwright'), WebSocket = require('ws');
const base = 'http://127.0.0.1:4317', workspaceId = 'b64c057e-96ee-435a-a078-a501e8f0d128';
const key = process.argv[2];
assert.ok(['glm', 'deepseek', 'probe'].includes(key));
const out = resolve('artifacts/codebuddy-repair-20261106-01'); mkdirSync(out, { recursive: true });
const dbPath = '/Users/dane/Library/Application Support/Axiom2/axiom.sqlite';
const modelId = key === 'glm' ? 'glm-5.3' : 'deepseek-v4.1-flash';
const display = key === 'glm' ? 'GLM-5.3' : 'DeepSeek-V4.1-Flash';
const controlPath = join(out, `${key}-control.json`), reportPath = join(out, `${key}-report.json`);
const controls = existsSync(controlPath) ? JSON.parse(readFileSync(controlPath)) : {};
let scope = { workspaceId, sessionId: controls.sessionId }, browser, page, lastSelection = controls.lastSelection;
let restored = false, activeRun, caseFailed = false, gate = 'start';
const saveControls = () => writeFileSync(controlPath, JSON.stringify({ ...controls, sessionId: scope.sessionId, lastSelection, restored }, null, 2));
const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath)) : { model: modelId, cases: [], observations: {} };
const saveReport = () => writeFileSync(reportPath, JSON.stringify(report, null, 2));
const pending = new Map(), snapshots = new Map();
const ws = new WebSocket(base.replace('http', 'ws') + '/ws', { origin: base });
let streamCount = 0, streamChars = 0;
ws.on('message', raw => {
  const value = JSON.parse(raw.toString());
  if (value.type === 'receipt' && pending.has(value.requestId)) {
    const p = pending.get(value.requestId); pending.delete(value.requestId); clearTimeout(p.timer);
    value.ok ? p.resolve(value.data) : p.reject(Error('receipt-failed'));
  }
  if (value.type === 'snapshot') {
    snapshots.set(value.scope, value.data);
    if (value.scope.startsWith(`message:${scope.workspaceId}:${scope.sessionId}:`) && value.data?.role === 'assistant' && value.data.streaming) {
      streamCount++; streamChars = Math.max(streamChars, value.data.textLength ?? value.data.text?.length ?? 0);
    }
  }
});
ws.on('error', () => {});
function call(op, params = {}, target = scope) {
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(requestId); reject(Error('receipt-timeout')); }, 20000);
    pending.set(requestId, { resolve, reject, timer }); ws.send(JSON.stringify({ requestId, op, params, ...target }));
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 180000) {
  const end = Date.now() + ms;
  do { const v = await fn(); if (v) return v; await sleep(250); } while (Date.now() < end);
  throw Error('bounded-timeout');
}
const agent = () => snapshots.get(`agent:${workspaceId}:${scope.sessionId}`);
async function subscribe(target = scope) {
  for (const name of ['agent', 'messages', 'thread']) await call('subscribe', { scope: `${name}:${workspaceId}:${target.sessionId}` }, target);
  return until(() => snapshots.get(`agent:${workspaceId}:${target.sessionId}`), 10000);
}
const same = (a, b) => a && b && ['provider', 'id', 'thinking'].every(k => a[k] === b[k]);
function native() {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  let row; try { row = db.prepare('SELECT file FROM agent_sessions WHERE sessionId=?').get(scope.sessionId); } finally { db.close(); }
  if (!row?.file) return [];
  const raw = readFileSync(row.file, 'utf8'), lines = raw.split('\n');
  return lines.flatMap((line, i) => {
    if (!line.trim()) return [];
    try { const entry = JSON.parse(line); return entry.type === 'message' ? [entry.message] : []; }
    catch { if (i === lines.length - 1 && !raw.endsWith('\n')) return []; throw Error('history-invalid'); }
  });
}
function summary(messages) {
  const assistants = messages.filter(m => m.role === 'assistant'), results = messages.filter(m => m.role === 'toolResult');
  const text = assistants.map(m => (m.content || []).filter(b => b.type === 'text').map(b => b.text).join('')).filter(Boolean).at(-1) || '';
  const calls = assistants.flatMap(m => (m.content || []).filter(b => b.type === 'toolCall'));
  return { assistants, results, text, calls };
}
function safeSummary(s) {
  return { assistants: s.assistants.length, toolCalls: s.calls.length, toolResults: s.results.length,
    toolNames: [...new Set(s.calls.map(c => c.name))].filter(n => ['read', 'write', 'edit', 'bash', 'memory_query', 'delegate'].includes(n)),
    imageResults: s.results.filter(m => m.content?.some(b => b.type === 'image')).length,
    toolErrors: s.results.filter(m => m.isError).length,
    thinkingChars: s.assistants.reduce((n, m) => n + (m.content || []).filter(b => b.type === 'thinking').reduce((v, b) => v + (b.thinking?.length || 0), 0), 0),
    textChars: s.text.length,
    failures: s.assistants.flatMap(m => (m.diagnostics || []).filter(d => d.type === 'codebuddy-failure').map(d => {
      const value = {}; for (const k of ['stage', 'partial', 'protocolCode', 'status', 'businessCode', 'retry']) {
        const v = d.details?.[k]; if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string' && /^[a-zA-Z0-9_-]{1,48}$/.test(v)) value[k] = v;
      } return value;
    })) };
}
async function select(thinking) {
  const next = { provider: 'codebuddy-cn', id: modelId, thinking };
  if (same(agent()?.selection, next)) { lastSelection = next; saveControls(); return; }
  gate = 'model-open';
  await page.locator('#model-picker summary').click();
  // Model labels are observed from configured UI, never guessed as protocol model IDs.
  await page.locator('.model-option').first().waitFor();
  const options = page.locator('.model-option');
  let found;
  for (let i = 0; i < await options.count(); i++) {
    const label = await options.nth(i).getAttribute('data-tooltip');
    if (label?.toLowerCase() === `workbuddy / ${display}`.toLowerCase()) { found = options.nth(i); break; }
  }
  gate = 'model-choice';
  assert.ok(found); await found.click();
  await page.locator(`.model-level input[value="${thinking}"]`).check();
  gate = 'model-confirm';
  await page.locator('.model-confirm').click();
  lastSelection = next; saveControls();
  gate = 'model-readback';
  await until(() => same(agent()?.selection, next), 10000);
}
async function pasteImage(path) {
  await page.locator('#prompt').evaluate((node, { data }) => {
    const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob(data), c => c.charCodeAt(0))], 'visual-fixture.png', { type: 'image/png' }));
    node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, { data: readFileSync(path).toString('base64') });
  await page.getByRole('button', { name: /^移除附件：/ }).waitFor();
  await until(() => page.getByRole('button', { name: '发送消息', exact: true }).isEnabled(), 15000);
}
async function turn(name, prompt, check, options = {}) {
  const previous = report.cases.find(c => c.case === name);
  if (previous?.passed) return;
  if (previous || existsSync(join(out, `${key}-${name}.claim`))) throw Error('claim-exhausted');
  writeFileSync(join(out, `${key}-${name}.claim`), 'exclusive prompt admission\n', { flag: 'wx' });
  const start = Date.now(), offset = native().length, prev = agent()?.run?.id;
  const result = { case: name, model: modelId, thinking: agent()?.selection?.thinking, passed: false };
  streamCount = 0; streamChars = 0;
  try {
    await page.locator('#prompt').fill(prompt);
    if (options.image) await pasteImage(options.image);
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    let stopped = false;
    activeRun = await until(async () => {
      const run = agent()?.run;
      if (!run || run.id === prev) return false;
      const current = summary(native().slice(offset));
      if (current.assistants.length > 8 || current.calls.length > 12) { await call('agent.stop', { runId: run.id }); throw Error('case-budget'); }
      if (options.cancel && !stopped && streamChars > 40) { stopped = true; await call('agent.stop', { runId: run.id }); }
      return ['completed', 'failed', 'cancelled', 'interrupted'].includes(run.status) && run;
    });
    const s = summary(native().slice(offset));
    result.status = activeRun.status; Object.assign(result, safeSummary(s));
    result.streamSnapshots = streamCount;
    assert.ok(same(activeRun.selection, lastSelection));
    assert.equal(activeRun.status, options.cancel ? 'cancelled' : 'completed');
    if (!options.cancel) {
      assert.ok(s.assistants.length > 0);
      assert.ok(s.assistants.every(m => m.provider === 'codebuddy-cn' && m.model === modelId && !['error', 'aborted', 'length'].includes(m.stopReason)));
    } else assert.ok(stopped && streamChars > 40);
    await check(s); result.passed = true;
    console.log(JSON.stringify({ case: name, passed: true, model: modelId, toolCalls: s.calls.length, imageResults: result.imageResults }));
  } catch {
    caseFailed = true;
    const s = summary(native().slice(offset)); Object.assign(result, safeSummary(s));
    result.category = 'case-failed';
    const run = agent()?.run;
    if (run && run.id !== prev && ['starting', 'running', 'stopping'].includes(run.status)) await call('agent.stop', { runId: run.id }).catch(() => {});
    console.log(JSON.stringify({ case: name, passed: false, model: modelId, failures: result.failures }));
    throw Error('case-failed');
  } finally { result.ms = Date.now() - start; report.cases.push(result); saveReport(); activeRun = undefined; }
}
async function restoreDefault() {
  if (!controls.originalSelection || !lastSelection) return;
  const probe = await call('session.create', { reuseEmpty: false }, { workspaceId });
  const target = { workspaceId, sessionId: probe.id };
  const snapshot = await subscribe(target);
  if (same(snapshot.selection, lastSelection)) {
    await call('agent.model', { selection: controls.originalSelection }, target);
    const readback = await call('session.create', { reuseEmpty: false }, { workspaceId });
    const next = await subscribe({ workspaceId, sessionId: readback.id });
    restored = same(next.selection, controls.originalSelection);
    report.observations.defaultRestored = restored;
  } else report.observations.defaultRestoreSkippedConcurrentChange = true;
  saveReport(); saveControls();
}
try {
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  if (!scope.sessionId) {
    const created = await call('session.create', { reuseEmpty: false }, { workspaceId }); scope.sessionId = created.id;
    const a = await subscribe(); controls.originalSelection = a.selection; saveControls();
    await call('session.rename', { title: `CodeBuddy native repair ${key}` });
  } else await subscribe();
  browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(15000);
  await page.addInitScript(s => sessionStorage.setItem('view', JSON.stringify(s)), scope);
  await page.goto(base); await page.locator('#prompt').waitFor();
  report.observations.formalUiLoaded = true;
  gate = 'fixture-preparation';
  if (key === 'probe') { console.log(JSON.stringify({ ready: true, selectionKeys: Object.keys(agent()?.selection || {}), modelOptionCount: await page.locator('#model-picker').count() })); }
  else {
    const scratch = join(out, key); mkdirSync(scratch, { recursive: true });
    const fixture = join(scratch, 'owned.txt'), imagePath = join(scratch, 'visual.png');
    // Synthetic graphic only, no application screenshot or raw conversation saved.
    if (!existsSync(imagePath)) {
      const synthetic = await browser.newPage({ viewport: { width: 320, height: 240 }, deviceScaleFactor: 1 });
      await synthetic.setContent(`<style>body{margin:0;background:white;display:grid;place-items:center;height:100vh}.shape{width:130px;height:130px;background:${key === 'glm' ? '#e51b23' : '#17a34a'};border-radius:${key === 'glm' ? '50%' : '0'}}</style><div class="shape"></div>`);
      await synthetic.screenshot({ path: imagePath }); await synthetic.close();
    }
    const expectedColor = key === 'glm' ? /红|red/i : /绿|green/i, expectedShape = key === 'glm' ? /圆|circle/i : /方|square/i;
    const prefix = `这是有界功能验收。不要代理或联网，不检查项目文件或凭据；工具仅限${scratch}及本测试会话自己的记忆。非本轮要求不调用工具。`;
    await select('off');
    await turn('01-text', `${prefix}记住代号松柏-5832，数字137。只回复：已记住·🙂。`, s => { assert.match(s.text, /已记住/); assert.match(s.text, /🙂/); });
    await select('high');
    await turn('02-memory-thinking', `${prefix}不调用工具，回忆我刚才给的代号，计算那个数字加19。只给代号与结果。`, s => { assert.match(s.text, /松柏.?5832/); assert.match(s.text, /156/); });
    await select('off');
    await turn('03-tools', `${prefix}请依序真实执行：write创建${fixture}内容alpha=17换行；edit精确替换alpha=17为alpha=23；read读回；bash仅运行python3 -c "from pathlib import Path; print(Path('${fixture}').read_text().strip())"。最后回复文件内的最终键值。不调用其他工具，不改其他文件。`, s => {
      for (const name of ['write', 'edit', 'read', 'bash']) assert.ok(s.calls.some(c => c.name === name));
      assert.equal(readFileSync(fixture, 'utf8').trim(), 'alpha=23'); assert.match(s.text, /alpha\s*=\s*23/);
      assert.ok(s.calls.every(c => s.results.some(r => r.toolCallId === c.id)));
    });
    await turn('04-tool-recovery', `${prefix}请read读取${join(scratch, 'absent.txt')}，预期不存在。然后read读取${fixture}，最后只给正常文件键值并说明已从错误恢复。不要创建缺失文件。`, s => { assert.ok(s.results.some(r => r.isError)); assert.ok(s.results.some(r => !r.isError)); assert.match(s.text, /23/); });
    await turn('05-image', `${prefix}请用read查看这次上传附件，报告图中的主要颜色和几何形状。不猜测文件名，不写程序解析图像。`, s => {
      assert.ok(s.results.some(r => r.content?.some(b => b.type === 'image'))); assert.match(s.text, expectedColor); assert.match(s.text, expectedShape);
    }, { image: imagePath });
    await page.reload(); await page.locator('#prompt').waitFor();
    const original = await call('agent.original');
    report.observations.refreshHistoryVisible = original.some(m => m.role === 'assistant') && await page.locator('.history-row[aria-current="true"], .history-row [aria-current="true"]').count() > 0;
    saveReport();
    await turn('06-image-history', `${prefix}不读文件，不调用工具：回忆刚才图片颜色形状，再给出第一轮代号和数字。`, s => { assert.match(s.text, expectedColor); assert.match(s.text, expectedShape); assert.match(s.text, /松柏.?5832/); assert.match(s.text, /137/); });
    await turn('07-cancel', `${prefix}不调用工具。开始直接连续输出1到2000，每行写序号和“春风🙂”。不要前言，不要代码，不省略。`, () => {}, { cancel: true });
    await turn('08-after-cancel', `${prefix}不调用工具，刚才输出已由用户取消。现在只回答：恢复正常🙂，并回忆第一轮代号。`, s => { assert.match(s.text, /恢复正常/); assert.match(s.text, /松柏.?5832/); });
    report.observations.allCasesPassed = report.cases.length === 8 && report.cases.every(c => c.passed);
    saveReport();
  }
} catch {
  report.observations.harnessStopped = true; report.observations.category = caseFailed ? 'case-failed' : 'harness-gate'; report.observations.gate = gate; saveReport(); process.exitCode = 1;
} finally {
  if (key !== 'probe') await restoreDefault().catch(() => { report.observations.defaultRestoreFailed = true; saveReport(); });
  await browser?.close(); ws.close();
  for (const p of pending.values()) clearTimeout(p.timer);
}
