// Testable controls and semantic assertions for the opt-in live AXIOM matrix.
// No direct AXIOM connection, model request, transcript access, or code evaluation.
import assert from 'node:assert/strict';
import { win32 } from 'node:path';

export function paceMilliseconds(value = 0) {
  assert.ok(typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value)), 'pace-ms must be an integer');
  const n = Number(value);
  assert.ok(Number.isSafeInteger(n) && n >= 0 && n <= 120_000, 'pace-ms must be an integer from 0 to 120000');
  return n;
}
export function receiptTag(value = '') {
  assert.ok(typeof value === 'string' && /^(?:[a-z0-9][a-z0-9-]{0,39})?$/.test(value), 'Use a short, path-safe receipt-tag');
  return value;
}
// Only for selection commands: RELOAD_BUSY is rejected before any mutation.
// A completed reload event can precede the job's finally/lock release. Never
// retry prompt, transport/receipt timeouts, or an error with uncertain effects.
export async function selectAfterReloadRelease(select, wait) {
  for (let busyRetries = 0; ; busyRetries++) {
    try { return await select(); }
    catch (error) {
      if (error?.code !== 'RELOAD_BUSY' || busyRetries >= 40) throw error;
      await wait(250);
    }
  }
}
// Queued task receipts can have runId=null. The durable input identity, not a
// different/latest run or an answer hash, establishes which run owns our prompt.
export function correlatePrompt(receipt, messages, { taskId, text }) {
  assert.equal(receipt.taskId, taskId, 'Receipt must identify the owned dedicated task');
  assert.ok(typeof receipt.inputId === 'string' && receipt.inputId, 'Receipt must identify its input');
  const matching = messages.filter(m => m.role === 'user' && m.inputIds?.includes(receipt.inputId));
  if (!matching.length) return null;
  assert.equal(matching.length, 1, 'Input must correlate to exactly one user message');
  const message = matching[0];
  assert.equal(message.inputIds.length, 1, 'Do not accept a merged unrelated input');
  assert.ok(typeof message.runId === 'string' && message.runId, 'User input must identify its actual run');
  if (receipt.runId) assert.equal(receipt.runId, message.runId, 'Receipt and user run must agree');
  assert.ok(message.text.includes(text), 'The actual user message must contain the sent prompt');
  return { runId: message.runId, userMessageId: message.id, inputId: receipt.inputId };
}
const inventory = { red: 14, blue: 28, green: 9, total: 51 };
const sessionInventory = { red: 14, blue: 28, green: 9, yellow: 5, total: 56 };
const archiveA = { ARCHIVE_KEY: 'R4Q9', ARCHIVE_VALUE: 318 };
const archiveB = { ARCHIVE_KEY: 'F2M6', ARCHIVE_VALUE: 427 };
const receipt = { marker: 'MATRIX-K3', checkword: '白鹭', total: 56 };
const schema = {
  '02': 'JSON字段：marker、checkword、inventory（red、blue、green、total）。',
  '03': 'JSON字段：schedule（键为甲、乙、丙，值为星期名称；中文或英文均可）、blueMinusRed（整数差）。',
  '04': '必须等第一个read返回ENOENT失败后，再调用账本read；不要在同一条assistant消息中并行发起。最终JSON字段：status（RECOVERED）、total、marker。',
  '05': 'JSON字段：checkword、multiplication、inventory（red、blue、green、total）。',
  '06': 'JSON字段：ARCHIVE_KEY、ARCHIVE_VALUE。',
  '07': 'JSON字段：ARCHIVE_KEY、ARCHIVE_VALUE、marker、checkword。',
  '08': 'JSON字段：consistent（布尔值）、inventory和ledger（两者均有red、blue、green、total）。',
  '09': 'JSON字段：red、blue、green、yellow、total。',
  '10': 'PowerShell命令中直接使用题给文件完整绝对路径以关联证据，不要通过变量拼接路径；等待写入结果成功后再发起read。写入文件及最终回复的JSON均固定使用字段marker、checkword、total；按本会话实际值填入，不使用其他字段名。',
  '11': 'JSON字段：CODE、red、blue、green、total。',
  '12': 'JSON字段：CODE、total（样本A）、sessionTotal（会话库存）。',
  '15': 'JSON字段：archiveA和archiveB（两者均有ARCHIVE_KEY、ARCHIVE_VALUE）、sum。',
  '16': 'JSON字段：marker、checkword、multiplication、diskTotal、sessionTotal、archiveAValue、archiveBValue、archiveSum。',
  '17': 'PowerShell命令只执行题给的throw语句；等待其失败结果返回后再发起read，不要并行。最终回复仍以RECOVERED_JSON开头，后接JSON对象，字段为marker、checkword、total。',
  '18': '为消除转义歧义：path字段JSON解码后的值由C:、一个反斜杠、probe、一个反斜杠、receipt.json依次连接；quote解码后为a、双引号、b三个字符。',
  '19': 'JSON字段：marker、checkword、multiplication、diskInventory（red、blue、green、total）、sessionInventory（red、blue、green、yellow、total）、archiveA和archiveB（ARCHIVE_KEY、ARCHIVE_VALUE）、archiveSum。',
};
export function controlledPrompt(label, text, enabled = false) {
  if (!enabled) return text;
  let hint = schema[label.slice(5, 7)] ?? '';
  if (label === 'long-13-tool-image') hint = 'JSON字段：CODE、red、blue、green、total。';
  if (label === 'long-13-code-review') hint = 'JSON字段：code（保留reduce累加器并补显式初值0的最小修复源码字符串）、total（会话库存总数）。';
  if (label === 'long-14-history-recall') hint = '若比较图片，按图A减图B计算，JSON字段aCODE、bCODE、totalDifference、redDifference；若是文本算术题，JSON字段difference、archivePlusYellow。';
  return '工具权限逐轮明确：此前用户消息中的“不调用工具”只限其各自那一轮；本轮若明确要求工具，现撤销此前用户层面的该限制并授权按本条执行。其他系统和文件范围限制不变。\n\n' + text + (hint ? '\n\n字段约定只规定结构，不提供答案：' + hint : '');
}

export function semanticJson(answer) {
  const source = String(answer).trim().replace(/^RECOVERED_JSON\s*:?\s*/, '');
  try { return JSON.parse(source); } catch { /* Semantic and strict-format checks are separate. */ }
  for (const match of source.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    try { return JSON.parse(match[1]); } catch { /* Continue to an actual JSON object. */ }
  }
  // Permit explanatory prose around one object for semantic checks only. Never
  // evaluate generated JavaScript or accept plain-text function-call lookalikes.
  const start = source.indexOf('{');
  if (start >= 0) {
    let depth = 0, quoted = false, escaped = false;
    for (let i = start; i < source.length; i++) {
      const c = source[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return JSON.parse(source.slice(start, i + 1));
    }
  }
  assert.fail('Expected a structured JSON answer');
}
function fields(value, expected) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Expected a JSON object');
  for (const [key, item] of Object.entries(expected)) assert.deepEqual(value[key], item, `Incorrect field: ${key}`);
}
function weekday(value) {
  const v = String(value).toLowerCase().replace(/\s/g, '');
  return ({ '周二': 2, '星期二': 2, '二': 2, 'tuesday': 2, 'tue': 2, '2': 2,
    '周三': 3, '星期三': 3, '三': 3, 'wednesday': 3, 'wed': 3, '3': 3,
    '周四': 4, '星期四': 4, '四': 4, 'thursday': 4, 'thu': 4, '4': 4 })[v];
}
export function controlledFormat(label, answer) {
  const text = String(answer).trim();
  if (label === 'long-01-seed' || label === 'long-20-checksum') return { kind: 'one-line', complied: !/[\r\n]/.test(text) };
  const prefix = label === 'long-17-shell-recovery';
  try { const object = JSON.parse(prefix ? text.replace(/^RECOVERED_JSON\s*:?\s*/, '') : text); return { kind: prefix ? 'prefix-json' : 'json-only', complied: (!prefix || text.startsWith('RECOVERED_JSON')) && !!object && typeof object === 'object' && !Array.isArray(object) }; }
  catch { return { kind: prefix ? 'prefix-json' : 'json-only', complied: false }; }
}
export function assertControlledAnswer(label, record, { vision = false } = {}) {
  const text = record.answer.trim();
  if (label === 'long-01-seed') return assert.match(text, /^MATRIX-K3\s+703\s+白鹭$/);
  if (label === 'long-20-checksum') return assert.match(text, /^MATRIX-K3\s+白鹭\s+1555$/);
  const object = label === 'long-18-unicode' ? JSON.parse(text) : semanticJson(text);
  const round = label.slice(5, 7);
  if (round === '02') return fields(object, { marker: 'MATRIX-K3', checkword: '白鹭', inventory });
  if (round === '03') {
    assert.deepEqual(['甲', '乙', '丙'].map(name => weekday(object.schedule?.[name])), [3, 2, 4], 'Incorrect schedule');
    return fields(object, { blueMinusRed: 14 });
  }
  if (round === '04') return fields(object, { status: 'RECOVERED', total: 51, marker: 'MATRIX-K3' });
  if (round === '05') return fields(object, { checkword: '白鹭', multiplication: 703, inventory });
  if (round === '06') return fields(object, archiveA);
  if (round === '07') return fields(object, { ...archiveA, marker: 'MATRIX-K3', checkword: '白鹭' });
  if (round === '08') return fields(object, { consistent: true, inventory, ledger: inventory });
  if (round === '09') return fields(object, sessionInventory);
  if (round === '10' || round === '17') return fields(object, receipt);
  if (round === '11') return fields(object, { CODE: 'N4P8', red: 7, blue: 4, green: 9, total: 20 });
  if (round === '12') return fields(object, { CODE: 'N4P8', total: 20, sessionTotal: 56 });
  if (label === 'long-13-tool-image') return fields(object, { CODE: 'R6W2', red: 3, blue: 8, green: 5, total: 16 });
  if (label === 'long-13-code-review') { fields(object, { total: 56 }); assert.equal(typeof object.code, 'string'); return assert.match(object.code, /\.reduce\s*\([\s\S]*,\s*0\s*\)/, 'Expected an explicit reduce initial value; generated code is not executed'); }
  if (round === '14') return vision ? fields(object, { aCODE: 'N4P8', bCODE: 'R6W2', totalDifference: 4, redDifference: 4 }) : fields(object, { difference: 652, archivePlusYellow: 323 });
  if (round === '15') return fields(object, { archiveA, archiveB, sum: 745 });
  if (round === '16') return fields(object, { marker: 'MATRIX-K3', checkword: '白鹭', multiplication: 703, diskTotal: 51, sessionTotal: 56, archiveAValue: 318, archiveBValue: 427, archiveSum: 745 });
  if (round === '18') return fields(object, { word: '白鹭', quote: 'a"b', path: 'C:\\probe\\receipt.json', emoji: '🐦' });
  if (round === '19') return fields(object, { marker: 'MATRIX-K3', checkword: '白鹭', multiplication: 703, diskInventory: inventory, sessionInventory, archiveA, archiveB, archiveSum: 745 });
  assert.fail('Unknown controlled matrix round');
}

// This checks observable tool evidence, not an assistant's claim that a tool ran.
// Ordering is based on the AXIOM original-message projection, not array order of
// parallel calls. Tool inputs/results remain local and are not published.
export function assertControlledTools(label, record, { root, modelId, receiptPath, cwd = 'F:/Axiom/axiom2' } = {}) {
  const calls = record.calls ?? [], results = record.results ?? [];
  const round = label.slice(5, 7);
  const needsTools = ['02', '04', '08', '10', '17'].includes(round) || label === 'long-13-tool-image';
  if (!needsTools) {
    assert.equal(calls.length, 0, 'This round prohibits tools');
    assert.equal(results.length, 0, 'Unexpected tool results in a no-tool round');
    if (label === 'long-11-user-image') assert.equal(record.promptImages?.length, 1, 'The user image must actually be attached');
    return;
  }
  const positions = new Map((record.messageIds ?? []).map((m, i) => [m.id, i]));
  assert.equal(new Set(calls.map(c => c.id)).size, calls.length, 'Duplicate call IDs');
  assert.equal(new Set(results.map(r => r.callId)).size, results.length, 'Duplicate result IDs');
  assert.equal(calls.length, results.length, 'Each actual call requires its own result');
  const name = value => String(value).replace(/^functions\./, '');
  const canonical = value => {
    assert.equal(typeof value, 'string', 'Expected an actual tool path');
    return win32.resolve(cwd, value).replace(/\\/g, '/').toLowerCase();
  };
  const pairs = calls.map(call => {
    const result = results.find(r => r.callId === call.id);
    assert.ok(result, 'Missing paired tool result');
    assert.equal(name(result.toolName), name(call.name), 'Tool result name must match its call');
    const callAt = positions.get(call.messageId), resultAt = positions.get(result.id);
    assert.ok(Number.isInteger(callAt) && Number.isInteger(resultAt) && resultAt > callAt, 'Call and result must be ordered in the original messages');
    const input = typeof call.input === 'string' ? JSON.parse(call.input) : call.input;
    assert.ok(input && typeof input === 'object' && !Array.isArray(input), 'Expected structured actual tool input');
    return { call, result, input, callAt, resultAt, name: name(call.name) };
  });
  const allowed = ['10', '17'].includes(round) ? ['read', 'powershell'] : ['read'];
  assert.ok(pairs.every(p => allowed.includes(p.name)), 'Unexpected tool for this controlled round');
  const read = path => {
    const pair = pairs.find(p => p.name === 'read' && canonical(p.input.path) === canonical(path));
    assert.ok(pair, 'Expected actual read of the specified target');
    return pair;
  };
  const successful = pair => { assert.equal(pair.result.status, 'completed', 'Expected a successful paired result'); return pair; };
  const ledger = pair => fields(JSON.parse(pair.result.text.trim()), inventory);
  const receiptResult = pair => fields(JSON.parse(pair.result.text.trim()), receipt);
  if (round === '02' || round === '08') {
    const csv = successful(read(root + '/inventory.csv'));
    assert.match(csv.result.text, /color,initial,delta/, 'Expected actual CSV contents');
    if (round === '08') ledger(successful(read(root + '/ledger.json')));
  } else if (round === '04') {
    const missing = read(root + '/expected-missing-' + modelId + '.txt');
    assert.equal(missing.result.status, 'failed', 'The intended missing-file read must actually fail');
    assert.match(missing.result.text, /ENOENT/, 'Expected the intended missing-file error');
    const next = successful(read(root + '/ledger.json'));
    assert.ok(next.callAt > missing.resultAt, 'Ledger read must follow the failed read result');
    ledger(next);
  } else if (round === '10' || round === '17') {
    const shells = pairs.filter(p => p.name === 'powershell');
    assert.ok(shells.length, 'Expected an actual PowerShell call');
    let shell;
    if (round === '10') {
      shell = shells.find(p => String(p.input.command).replace(/\\/g, '/').toLowerCase().includes(canonical(receiptPath)));
      assert.ok(shell, 'The write command must identify the full receipt path');
      successful(shell);
    } else {
      assert.ok(shells.every(p => /^\s*throw\s+(['"])EXPECTED_MATRIX_RECOVERY\1\s*;?\s*$/i.test(p.input.command)), 'Only the specified recovery throw is allowed');
      shell = shells.find(p => p.result.status === 'failed' && /EXPECTED_MATRIX_RECOVERY/.test(p.result.text));
      assert.ok(shell, 'The intended PowerShell command must genuinely fail');
    }
    const next = successful(read(receiptPath));
    assert.ok(next.callAt > shell.resultAt, 'Receipt read must follow the PowerShell result');
    receiptResult(next);
  } else {
    const image = successful(read(root + '/visual-b.png'));
    assert.ok(image.result.images?.length > 0, 'The paired read result must actually contain an image');
  }
}
