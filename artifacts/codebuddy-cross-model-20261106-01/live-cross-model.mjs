// NOT ADMITTED: independent review found default/permission/retry race boundaries.
// Retained for audit only; replaced by live-native-history.mjs under CASE-CONTRACT.md.
throw new Error('unadmitted-ui-plan-do-not-execute');
// Context and signatures remain in RAM / normal app history.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
const require = createRequire(resolve('app/package.json'));
const { chromium } = require('playwright'), WebSocket = require('ws');
const base = 'http://127.0.0.1:4317', workspaceId = 'b64c057e-96ee-435a-a078-a501e8f0d128';
const out = resolve('artifacts/codebuddy-cross-model-20261106-01'); mkdirSync(out, { recursive: true });
const controlPath = join(out, 'local-control.json'), reportPath = join(out, 'live-report.json');
assert.ok(!existsSync(controlPath), 'one-shot-harness-already-admitted');
const fixture = join(out, 'synthetic.txt'); writeFileSync(fixture, 'fixture-value=58\n', { flag: 'wx' });
const report = { cases: [], observations: {} }, controls = {};
let scope = { workspaceId }, browser, page, lastSelection, gate = 'ws-open';
const snapshots = new Map(), pending = new Map(); let streamCount = 0;
const save = () => { writeFileSync(reportPath, JSON.stringify(report, null, 2)); writeFileSync(controlPath, JSON.stringify(controls, null, 2)); };
const ws = new WebSocket(base.replace('http', 'ws') + '/ws', { origin: base });
ws.on('message', raw => { const v = JSON.parse(raw.toString());
  if (v.type === 'receipt' && pending.has(v.requestId)) { const p = pending.get(v.requestId); pending.delete(v.requestId); clearTimeout(p.timer); v.ok ? p.resolve(v.data) : p.reject(Error('receipt-failed')); }
  if (v.type === 'snapshot') { snapshots.set(v.scope, v.data); if (v.scope.startsWith(`message:${workspaceId}:${scope.sessionId}:`) && v.data?.role === 'assistant' && v.data.streaming) streamCount++; }
}); ws.on('error', () => {});
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 180000) { const end = Date.now() + ms; do { const value = await fn(); if (value) return value; await sleep(250); } while (Date.now() < end); throw Error('bounded-timeout'); }
function call(op, params = {}, target = scope) { const requestId = randomUUID(); return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(requestId); reject(Error('receipt-timeout')); }, 20000); pending.set(requestId, { resolve, reject, timer }); ws.send(JSON.stringify({ requestId, op, params, ...target })); }); }
const agent = () => snapshots.get(`agent:${workspaceId}:${scope.sessionId}`);
const same = (a, b) => a && b && ['provider', 'id', 'thinking'].every(k => a[k] === b[k]);
async function subscribe(target = scope) { for (const name of ['agent', 'messages', 'thread']) await call('subscribe', { scope: `${name}:${workspaceId}:${target.sessionId}` }, target); return until(() => snapshots.get(`agent:${workspaceId}:${target.sessionId}`), 10000); }
function native() { const db = new DatabaseSync('/Users/dane/Library/Application Support/Axiom2/axiom.sqlite', { readOnly: true }); let file; try { file = db.prepare('SELECT file FROM agent_sessions WHERE sessionId=?').get(scope.sessionId)?.file; } finally { db.close(); } if (!file) return [];
  const raw = readFileSync(file, 'utf8'), lines = raw.split('\n'); return lines.flatMap((line, i) => { if (!line.trim()) return []; try { const v = JSON.parse(line); return v.type === 'message' ? [v.message] : []; } catch { if (i === lines.length - 1 && !raw.endsWith('\n')) return []; throw Error('history-invalid'); } }); }
function collect(messages) { const assistants = messages.filter(m => m.role === 'assistant'); return { assistants, calls: assistants.flatMap(m => (m.content || []).filter(b => b.type === 'toolCall')), results: messages.filter(m => m.role === 'toolResult'), text: assistants.map(m => (m.content || []).filter(b => b.type === 'text').map(b => b.text).join('')).filter(Boolean).at(-1) || '' }; }
function safe(s) { return { assistantCount: s.assistants.length, toolCalls: s.calls.length, toolResults: s.results.length, successfulResults: s.results.filter(r => !r.isError).length, signedThinking: s.assistants.flatMap(m => m.content || []).filter(b => b.type === 'thinking' && b.thinkingSignature !== undefined).length, compositeToolIds: s.calls.filter(c => c.id.includes('|')).length, textChars: s.text.length, thinkingChars: s.assistants.flatMap(m => m.content || []).filter(b => b.type === 'thinking').reduce((n, b) => n + (b.thinking?.length || 0), 0) }; }
async function select(label, expectedProvider) { gate = 'choose-model'; await page.locator('#model-picker summary').click(); await page.locator('.model-option').first().waitFor(); const options = page.locator('.model-option'); let found; for (let i = 0; i < await options.count(); i++) if ((await options.nth(i).getAttribute('data-tooltip'))?.toLowerCase() === label.toLowerCase()) { found = options.nth(i); break; } assert.ok(found); await found.click(); await page.locator('.model-level input[value="high"]').check(); await page.locator('.model-confirm').click(); await until(() => agent()?.selection?.provider === expectedProvider && agent()?.selection?.thinking === 'high', 10000); lastSelection = { ...agent().selection }; controls.lastSelection = lastSelection; save(); }
async function turn(name, prompt, check, expectedProvider) { gate = name; writeFileSync(join(out, `${name}.claim`), 'exclusive prompt admission\n', { flag: 'wx' }); const offset = native().length, previous = agent()?.run?.id, start = Date.now(); const result = { case: name, passed: false }; streamCount = 0;
  try { await page.locator('#prompt').fill(prompt); await page.getByRole('button', { name: '发送消息', exact: true }).click(); const run = await until(async () => { const r = agent()?.run; if (!r || r.id === previous) return false; const s = collect(native().slice(offset)); if (s.assistants.length > 6 || s.calls.length > 6) { await call('agent.stop', { runId: r.id }); throw Error('case-budget'); } return ['completed', 'failed', 'cancelled', 'interrupted'].includes(r.status) && r; });
    result.status = run.status; const s = collect(native().slice(offset)); Object.assign(result, safe(s)); result.streamSnapshots = streamCount; assert.equal(run.status, 'completed'); assert.ok(same(run.selection, lastSelection)); assert.ok(s.assistants.length && s.assistants.every(m => m.provider === expectedProvider && !['error', 'aborted', 'length'].includes(m.stopReason))); assert.ok(s.calls.length && s.calls.every(c => c.name === 'read' && s.results.some(r => r.toolCallId === c.id && !r.isError))); await check(s); result.passed = true;
  } catch { result.category = 'case-failed'; Object.assign(result, safe(collect(native().slice(offset)))); const r = agent()?.run; if (r && r.id !== previous && ['starting', 'running', 'stopping'].includes(r.status)) await call('agent.stop', { runId: r.id }).catch(() => {}); throw Error('case-failed'); }
  finally { result.ms = Date.now() - start; report.cases.push(result); save(); console.log(JSON.stringify({ case: name, passed: result.passed, ...safe(collect(native().slice(offset))) })); }
}
async function restore() { if (!controls.originalSelection || !lastSelection) return; const probe = await call('session.create', { reuseEmpty: false }, { workspaceId }); const target = { workspaceId, sessionId: probe.id }; const a = await subscribe(target); if (same(a.selection, lastSelection)) { await call('agent.model', { selection: controls.originalSelection }, target); const verify = await call('session.create', { reuseEmpty: false }, { workspaceId }); const next = await subscribe({ workspaceId, sessionId: verify.id }); report.observations.defaultRestored = same(next.selection, controls.originalSelection); } else report.observations.defaultRestoreSkippedConcurrentChange = true; save(); }
try { await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); }); gate = 'create-session'; const created = await call('session.create', { reuseEmpty: false }, { workspaceId }); scope.sessionId = created.id; controls.sessionId = created.id; const a = await subscribe(); controls.originalSelection = a.selection; save(); await call('session.rename', { title: 'Cross-model continuation acceptance' });
  browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }); page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(15000); await page.addInitScript(s => sessionStorage.setItem('view', JSON.stringify(s)), scope); await page.goto(base); await page.locator('#prompt').waitFor(); report.observations.formalUiLoaded = true;
  const prefix = `这是有界验收，不代理不联网不检查项目或凭据；工具只准read读取${fixture}，不调用其他工具或访问其他文件。`;
  await select('OpenAI / GPT-6.1 Sol Fast', 'openai');
  await turn('01-source', `${prefix}请真实read读取该文件；记住代号雪松-7641和数字246。最后只回复“已记住”、代号、数字以及文件的键值，不复述思考。`, s => { assert.match(s.text, /雪松.?7641/); assert.match(s.text, /246/); assert.match(s.text, /58/); assert.ok(safe(s).signedThinking > 0); assert.ok(safe(s).compositeToolIds > 0); }, 'openai');
  const beforeSwitch = safe(collect(native()));
  await select('Workbuddy / DeepSeek-V4.1-Flash', 'codebuddy-cn'); assert.equal(agent().selection.id, 'deepseek-v4.1-flash');
  await turn('02-target', `${prefix}保持现有历史，不重新介绍代号和数字。请回忆上一轮代号与数字，算出那个数字加31；再真实read同一文件。只给代号、原数字、计算结果及文件键值。`, s => { assert.match(s.text, /雪松.?7641/); assert.match(s.text, /246/); assert.match(s.text, /277/); assert.match(s.text, /58/); assert.ok(streamCount > 0); }, 'codebuddy-cn');
  report.observations.sourceHistoryBeforeSwitch = { signedThinking: beforeSwitch.signedThinking, compositeToolIds: beforeSwitch.compositeToolIds };
  const beforeReload = native().length; await page.reload(); await page.locator('#prompt').waitFor(); const original = await call('agent.original'); report.observations.reloadHistoryPreserved = native().length === beforeReload && original.some(m => m.role === 'assistant');
  report.observations.allCasesPassed = report.cases.length === 2 && report.cases.every(c => c.passed); save();
} catch { report.observations.harnessStopped = true; report.observations.gate = gate; process.exitCode = 1; save(); }
finally { await restore().catch(() => { report.observations.defaultRestoreFailed = true; save(); process.exitCode = 1; }); await browser?.close(); ws.close(); for (const p of pending.values()) clearTimeout(p.timer); }
