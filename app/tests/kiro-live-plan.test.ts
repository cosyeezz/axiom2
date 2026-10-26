import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
const { paceMilliseconds, receiptTag, controlledPrompt, semanticJson, controlledFormat, assertControlledAnswer, assertControlledTools, correlatePrompt, selectAfterReloadRelease, hydrateToolCalls } = await import(new URL("../scripts/kiro-live-plan.mjs", import.meta.url).href);

test("Kiro selection succeeds without a reload wait", async () => {
  let calls = 0;
  const info = { selection: { provider: "kiro", id: "auto", thinking: "off" } };
  assert.equal(await selectAfterReloadRelease(async () => { calls++; return info; }, async () => assert.fail("Unexpected wait")), info);
  assert.equal(calls, 1);
});

test("Kiro selection only retries rejected RELOAD_BUSY until the lock releases", async () => {
  let calls = 0;
  const waits: number[] = [], info = { selection: { id: "auto" } };
  const actual = await selectAfterReloadRelease(async () => {
    if (++calls < 3) throw Object.assign(new Error("busy"), { code: "RELOAD_BUSY" });
    return info;
  }, async (ms: number) => { waits.push(ms); });
  assert.equal(actual, info); assert.equal(calls, 3); assert.deepEqual(waits, [250, 250]);
});

test("Kiro selection never retries errors with uncertain effects", async () => {
  for (const code of [undefined, "RECEIPT_TIMEOUT", "CONNECTION_CLOSED", "MODEL_NOT_FOUND"]) {
    let calls = 0;
    const error = Object.assign(new Error("not a known rejected selection"), { code });
    await assert.rejects(selectAfterReloadRelease(async () => { calls++; throw error; }, async () => assert.fail("Unexpected wait")), actual => actual === error);
    assert.equal(calls, 1);
  }
});

test("Kiro selection bounds reload-lock waiting to forty 250ms waits", async () => {
  let calls = 0; const waits: number[] = [];
  const error = Object.assign(new Error("busy"), { code: "RELOAD_BUSY" });
  await assert.rejects(selectAfterReloadRelease(async () => { calls++; throw error; }, async (ms: number) => { waits.push(ms); }), actual => actual === error);
  assert.equal(calls, 41); assert.equal(waits.length, 40); assert.ok(waits.every(ms => ms === 250));
});

test("Kiro selection does not retry if its lock wait is interrupted", async () => {
  let calls = 0; const interrupted = new Error("wait interrupted");
  await assert.rejects(selectAfterReloadRelease(async () => { calls++; throw Object.assign(new Error("busy"), { code: "RELOAD_BUSY" }); }, async () => { throw interrupted; }), actual => actual === interrupted);
  assert.equal(calls, 1);
});

const inventory = { red: 14, blue: 28, green: 9, total: 51 };
const sessionInventory = { ...inventory, yellow: 5, total: 56 };
const archiveA = { ARCHIVE_KEY: "R4Q9", ARCHIVE_VALUE: 318 };
const archiveB = { ARCHIVE_KEY: "F2M6", ARCHIVE_VALUE: 427 };
const receipt = { marker: "MATRIX-K3", checkword: "白鹭", total: 56 };
const longMemory = { marker: "MATRIX-K3", checkword: "白鹭", multiplication: 703, diskTotal: 51, sessionTotal: 56, archiveAValue: 318, archiveBValue: 427, archiveSum: 745 };
const finalMemory = { marker: "MATRIX-K3", checkword: "白鹭", multiplication: 703, diskInventory: inventory, sessionInventory, archiveA, archiveB, archiveSum: 745 };
const cases: [string, unknown, boolean?][] = [
  ["long-01-seed", "MATRIX-K3 703 白鹭"],
  ["long-02-read", { marker: "MATRIX-K3", checkword: "白鹭", inventory }],
  ["long-03-reasoning", { schedule: { 甲: "周三", 乙: "星期二", 丙: "周四" }, blueMinusRed: 14 }],
  ["long-03-reasoning", { schedule: { 甲: "Wednesday", 乙: "Tuesday", 丙: "Thursday" }, blueMinusRed: 14 }],
  ["long-04-error-recovery", { status: "RECOVERED", total: 51, marker: "MATRIX-K3" }],
  ["long-05-off-memory", { checkword: "白鹭", multiplication: 703, inventory }],
  ["long-06-large-attachment", archiveA],
  ["long-07-delayed-memory", { ...archiveA, marker: "MATRIX-K3", checkword: "白鹭" }],
  ["long-08-two-reads", { consistent: true, inventory, ledger: inventory }],
  ["long-09-state-update", sessionInventory],
  ["long-10-write-read", receipt],
  ["long-11-user-image", { CODE: "N4P8", red: 7, blue: 4, green: 9, total: 20 }, true],
  ["long-11-text-table", { CODE: "N4P8", red: 7, blue: 4, green: 9, total: 20 }],
  ["long-12-follow-up", { CODE: "N4P8", total: 20, sessionTotal: 56 }],
  ["long-13-tool-image", { CODE: "R6W2", red: 3, blue: 8, green: 5, total: 16 }, true],
  ["long-13-code-review", { code: "function sum(xs){return xs.reduce((a,x)=>a+x,0)}", total: 56 }],
  ["long-14-history-recall", { aCODE: "N4P8", bCODE: "R6W2", totalDifference: 4, redDifference: 4 }, true],
  ["long-14-history-recall", { difference: 652, archivePlusYellow: 323 }],
  ["long-15-second-attachment", { archiveA, archiveB, sum: 745 }],
  ["long-16-grade-memory", longMemory],
  ["long-17-shell-recovery", "RECOVERED_JSON " + JSON.stringify(receipt)],
  ["long-18-unicode", { word: "白鹭", quote: 'a"b', path: "C:\\probe\\receipt.json", emoji: "🐦" }],
  ["long-19-final-ledger", finalMemory],
  ["long-20-checksum", "MATRIX-K3 白鹭 1555"],
];
for (const [index, [label, value, vision = false]] of cases.entries()) {
  test(`Kiro controlled semantics ${index + 1}: ${label}${vision ? " (vision)" : ""}`, () => {
    assertControlledAnswer(label, { answer: typeof value === "string" ? value : JSON.stringify(value) }, { vision });
  });
}

test("Kiro controlled semantic checks reject wrong mappings, missing values and number substrings", () => {
  const rejected: [string, unknown, boolean?][] = [
    ["long-02-read", { marker: "MATRIX-K3", checkword: "白鹭", inventory: { ...inventory, red: 28, blue: 14 } }],
    ["long-03-reasoning", { schedule: { 甲: "Tuesday", 乙: "Wednesday", 丙: "Thursday" }, blueMinusRed: 14 }],
    ["long-03-reasoning", { schedule: { 甲: "Wednesday", 乙: "Tuesday", 丙: "Thursday" }, blueMinusRed: null }],
    ["long-09-state-update", { red: 14, blue: 28, green: 9, total: 56 }],
    ["long-09-state-update", { ...sessionInventory, yellow: 56 }],
    ["long-11-text-table", { CODE: "N4P8", red: 4, blue: 7, green: 9, total: 20 }],
    ["long-14-history-recall", { aCODE: "N4P8", bCODE: "R6W2", totalDifference: 4, redDifference: -4 }, true],
    ["long-13-code-review", { code: "// 0\nfunction sum(xs){return xs.reduce((a,x)=>a+x)}", total: 56 }],
    ["long-16-grade-memory", { ...longMemory, diskTotal: 56, sessionTotal: 51 }],
    ["long-19-final-ledger", { ...finalMemory, archiveA: archiveB, archiveB: archiveA }],
  ];
  for (const [label, value, vision = false] of rejected) assert.throws(() => assertControlledAnswer(label, { answer: JSON.stringify(value) }, { vision }));
});

test("Kiro controlled Unicode checks require the decoded path, not literal escaping artifacts", () => {
  const value = { word: "白鹭", quote: 'a"b', path: "C:\\probe\\receipt.json", emoji: "🐦" };
  assert.equal([...value.path].filter(c => c === "\\").length, 2);
  assertControlledAnswer("long-18-unicode", { answer: JSON.stringify(value).replaceAll("白鹭", "\\u767d\\u9e6d") });
  assert.throws(() => assertControlledAnswer("long-18-unicode", { answer: JSON.stringify({ ...value, path: "C:\\\\probe\\\\receipt.json" }) }));
  assert.throws(() => assertControlledAnswer("long-18-unicode", { answer: "```json\n" + JSON.stringify(value) + "\n```" }));
});

test("Kiro semantic JSON can inspect prose or fences without claiming strict format compliance", () => {
  const answer = "Explanation\n```json\n" + JSON.stringify(sessionInventory) + "\n```";
  assertControlledAnswer("long-09-state-update", { answer });
  assert.deepEqual(controlledFormat("long-09-state-update", answer), { kind: "json-only", complied: false });
  assert.deepEqual(semanticJson('Explanation {"text":"a}\\\"b","nested":{"n":2}} trailing'), { text: 'a}"b', nested: { n: 2 } });
  assert.throws(() => semanticJson('<｜DSML｜function_calls>read("secret")'));
  assert.throws(() => semanticJson("not JSON"));
});

test("Kiro strict-format observations are separate from semantic correctness", () => {
  assert.deepEqual(controlledFormat("long-20-checksum", "MATRIX-K3 白鹭 1555"), { kind: "one-line", complied: true });
  assert.equal(controlledFormat("long-20-checksum", "MATRIX-K3\n白鹭 1555").complied, false);
  assert.equal(controlledFormat("long-17-shell-recovery", "RECOVERED_JSON " + JSON.stringify(receipt)).complied, true);
  assert.equal(controlledFormat("long-17-shell-recovery", JSON.stringify(receipt)).complied, false);
  assert.equal(controlledFormat("long-09-state-update", "[]").complied, false);
});

test("Kiro controlled prompt hints clarify scope and structure without supplying answer values", () => {
  assert.equal(controlledPrompt("long-09-state-update", "ORIGINAL"), "ORIGINAL");
  const controlled = controlledPrompt("long-09-state-update", "ORIGINAL", true);
  assert.match(controlled, /只限其各自那一轮/); assert.match(controlled, /ORIGINAL/); assert.match(controlled, /yellow/);
  assert.doesNotMatch(controlled, /MATRIX-K3|白鹭|56|318|427/);
  assert.match(controlledPrompt("long-10-write-read", "ORIGINAL", true), /完整绝对路径/);
  assert.match(controlledPrompt("long-17-shell-recovery", "ORIGINAL", true), /等待其失败结果返回/);
});

test("Kiro serial pacing and receipt tags reject unsafe or ambiguous options", () => {
  assert.equal(paceMilliseconds(), 0); assert.equal(paceMilliseconds("30000"), 30000); assert.equal(paceMilliseconds(120000), 120000);
  for (const value of [-1, 1.5, 120001, NaN, Infinity, "", "abc", "2.5", true, null]) assert.throws(() => paceMilliseconds(value));
  assert.equal(receiptTag(), ""); assert.equal(receiptTag("recovery-v2"), "recovery-v2");
  for (const value of ["../overwrite", "A", "a/b", "a\\b", "a".repeat(41), null]) assert.throws(() => receiptTag(value));
});

test("Kiro queued prompt correlation uses durable input identities, not the latest run", () => {
  const receipt = { taskId: "owned-task", inputId: "our-input", runId: null };
  const message = { id: "user-message", role: "user", inputIds: ["our-input"], runId: "actual-run", text: "prefix OUR-PROMPT suffix" };
  const options = { taskId: "owned-task", text: "OUR-PROMPT" };
  assert.deepEqual(correlatePrompt(receipt, [message], options), { runId: "actual-run", userMessageId: "user-message", inputId: "our-input" });
  assert.equal(correlatePrompt(receipt, [{ ...message, inputIds: ["another-input"] }], options), null);
  assert.throws(() => correlatePrompt({ ...receipt, taskId: "other-task" }, [message], options));
  assert.throws(() => correlatePrompt({ ...receipt, runId: "wrong-run" }, [message], options));
  assert.throws(() => correlatePrompt(receipt, [message, message], options));
  assert.throws(() => correlatePrompt(receipt, [{ ...message, inputIds: ["our-input", "other"] }], options));
  assert.throws(() => correlatePrompt(receipt, [{ ...message, text: "unrelated prompt" }], options));
});

const root = "C:/synthetic-kiro-fixtures/workspace";
const context = { root, modelId: "auto", receiptPath: root + "/matrix/auto/receipt-recovery-v2.json" };
type Step = { name: string; input: object; text: string; status?: string; images?: object[] };
function toolRecord(...steps: Step[]) {
  const record = { calls: [] as any[], results: [] as any[], messageIds: [] as any[], promptImages: [] as any[] };
  for (const [i, step] of steps.entries()) {
    const id = `call-${i}`, messageId = `assistant-${i}`, resultId = `tool-${i}`;
    record.calls.push({ id, name: step.name, input: JSON.stringify(step.input), messageId });
    record.results.push({ id: resultId, callId: id, toolName: step.name.replace(/^functions\./, ""), status: step.status ?? "completed", text: step.text, images: step.images ?? [] });
    record.messageIds.push({ id: messageId, role: "assistant" }, { id: resultId, role: "toolResult" });
  }
  return record;
}
const csvStep: Step = { name: "read", input: { path: root + "/inventory.csv" }, text: "color,initial,delta\nred,17,-3\nblue,23,5\ngreen,11,-2" };
const ledgerStep: Step = { name: "read", input: { path: root + "/ledger.json" }, text: JSON.stringify(inventory) };
const receiptStep: Step = { name: "read", input: { path: context.receiptPath }, text: "\ufeff" + JSON.stringify(receipt) };
const missingStep: Step = { name: "read", input: { path: root + "/expected-missing-auto.txt" }, status: "failed", text: "ENOENT: no such file" };
const throwStep: Step = { name: "powershell", input: { command: 'throw "EXPECTED_MATRIX_RECOVERY"' }, status: "failed", text: "EXPECTED_MATRIX_RECOVERY\nCommand exited with code 1" };
const writeStep: Step = { name: "powershell", input: { command: `Set-Content -Path '${context.receiptPath}' -Value '{}'` }, text: "" };

test("Kiro controlled tools accept paired real CSV/ledger evidence and normalized Windows paths", () => {
  assertControlledTools("long-02-read", toolRecord({ ...csvStep, name: "functions.read", input: { path: (root + "/inventory.csv").replaceAll("/", "\\") } }), context);
  assertControlledTools("long-08-two-reads", toolRecord(csvStep, ledgerStep), context);
  assertControlledTools("long-04-error-recovery", toolRecord(missingStep, ledgerStep), context);
});

test("Kiro controlled tools require successful writes and actual failed shells before receipt reads", () => {
  assertControlledTools("long-10-write-read", toolRecord(writeStep, receiptStep), context);
  assertControlledTools("long-17-shell-recovery", toolRecord(throwStep, receiptStep), context);
  assert.throws(() => assertControlledTools("long-17-shell-recovery", toolRecord({ ...throwStep, status: "completed" }, receiptStep), context));
  assert.throws(() => assertControlledTools("long-17-shell-recovery", toolRecord({ ...throwStep, input: { command: 'Write-Output "EXPECTED_MATRIX_RECOVERY"' } }, receiptStep), context));
  assert.throws(() => assertControlledTools("long-10-write-read", toolRecord(writeStep, { ...receiptStep, text: JSON.stringify({ ...receipt, total: 55 }) }), context));
});

test("Kiro controlled tools reject parallel scheduling that does not prove required recovery order", () => {
  for (const [label, first, second] of [["long-04-error-recovery", missingStep, ledgerStep], ["long-10-write-read", writeStep, receiptStep], ["long-17-shell-recovery", throwStep, receiptStep]] as const) {
    const record = toolRecord(first, second); record.calls[1].messageId = record.calls[0].messageId;
    assert.throws(() => assertControlledTools(label, record, context));
  }
});

test("Kiro controlled tools reject orphan, duplicate, wrong-name, wrong-path and missing evidence", () => {
  const orphan = toolRecord(csvStep); orphan.results[0].callId = "unrelated";
  assert.throws(() => assertControlledTools("long-02-read", orphan, context));
  const duplicate = toolRecord(csvStep, ledgerStep); duplicate.results[1].callId = duplicate.results[0].callId;
  assert.throws(() => assertControlledTools("long-08-two-reads", duplicate, context));
  const wrongName = toolRecord(csvStep); wrongName.results[0].toolName = "powershell";
  assert.throws(() => assertControlledTools("long-02-read", wrongName, context));
  assert.throws(() => assertControlledTools("long-02-read", toolRecord({ ...csvStep, input: { path: root + "/other.csv" } }), context));
  assert.throws(() => assertControlledTools("long-08-two-reads", toolRecord(csvStep, csvStep), context));
  assert.throws(() => assertControlledTools("long-04-error-recovery", toolRecord({ ...missingStep, status: "completed" }, ledgerStep), context));
});

test("Kiro controlled image checks require actual attachment or paired tool-image results", () => {
  const imageStep = { name: "read", input: { path: root + "/visual-b.png" }, text: "", images: [{ mimeType: "image/png" }] };
  assertControlledTools("long-13-tool-image", toolRecord(imageStep), context);
  assert.throws(() => assertControlledTools("long-13-tool-image", toolRecord({ ...imageStep, images: [] }), context));
  const record = toolRecord(); record.promptImages.push({ mimeType: "image/png" });
  assertControlledTools("long-11-user-image", record, context);
  assert.throws(() => assertControlledTools("long-11-user-image", toolRecord(), context));
});

test("Kiro controlled no-tool rounds cannot pass using an unrequested real tool", () => {
  assertControlledTools("long-09-state-update", toolRecord(), context);
  assert.throws(() => assertControlledTools("long-09-state-update", toolRecord(csvStep), context));
});

test("Kiro tool-input hydration leaves complete projections immutable and does not fetch", async () => {
  assert.deepEqual(await hydrateToolCalls({ id: "m", calls: [] }, async () => assert.fail("Unexpected detail")), []);
  const input = JSON.stringify({ path: "C:/fixture/input.csv" }), revision = createHash("sha256").update(input).digest("hex");
  const message = { id: "m", calls: [{ id: "c", name: "read", input, inputLength: input.length, inputRevision: revision }] };
  const before = structuredClone(message); Object.freeze(message.calls[0]); Object.freeze(message.calls); Object.freeze(message);
  const calls = await hydrateToolCalls(message, async () => assert.fail("Unexpected detail"));
  assert.equal(calls[0].input, input); assert.equal(calls[0].messageId, "m"); assert.equal(calls[0].fullInputRead, false);
  assert.deepEqual(message, before);
});

test("Kiro tool-input hydration binds a 512-character preview to the full message/call and hash", async () => {
  const input = JSON.stringify({ command: "x".repeat(900) }), revision = createHash("sha256").update(input).digest("hex");
  const message = { id: "original-message", calls: [{ id: "original-call", name: "powershell", input: input.slice(0, 512), inputLength: input.length, inputRevision: revision }] };
  let reads = 0;
  const calls = await hydrateToolCalls(message, async (params: any) => {
    reads++; assert.deepEqual(params, { id: message.id, field: "input", callId: "original-call" });
    return { text: input, totalLength: input.length, revision };
  });
  assert.equal(reads, 1); assert.equal(calls[0].input, input); assert.equal(calls[0].fullInputRead, true);
  assert.equal(calls[0].inputRevision, revision); assert.equal(JSON.parse(calls[0].input).command.length, 900);
});

test("Kiro tool-input hydration rejects incomplete, changed, or invalid detail metadata", async () => {
  const input = JSON.stringify({ command: "x".repeat(900) }), revision = createHash("sha256").update(input).digest("hex");
  const original = { id: "m", calls: [{ id: "c", name: "powershell", input: input.slice(0, 512), inputLength: input.length, inputRevision: revision }] };
  const detail = { text: input, totalLength: input.length, revision };
  const cases = [
    { ...detail, text: input.slice(0, 512) },
    { ...detail, totalLength: input.length - 1 },
    { ...detail, text: "!" + input.slice(1) },
    { ...detail, revision: "0".repeat(64) },
    { ...detail, text: input.slice(0, -2) + "y}", revision: createHash("sha256").update(input.slice(0, -2) + "y}").digest("hex") },
  ];
  for (const value of cases) await assert.rejects(hydrateToolCalls(original, async () => value));
  for (const length of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    const bad = structuredClone(original); bad.calls[0].inputLength = length;
    await assert.rejects(hydrateToolCalls(bad, async () => assert.fail("Must validate before reading")));
  }
});

test("Kiro tool-input detail read failures propagate without retrying or prompting", async () => {
  const input = "x".repeat(600), message = { id: "m", calls: [{ id: "c", name: "powershell", input: input.slice(0, 512), inputLength: input.length }] };
  let reads = 0;
  await assert.rejects(hydrateToolCalls(message, async () => { reads++; throw new Error("READ_FAILED"); }), /READ_FAILED/);
  assert.equal(reads, 1);
});

test("Kiro tool-input hydration preserves projected call order and separate identities", async () => {
  const full = JSON.stringify({ command: "x".repeat(800) }), short = "{}";
  const message = { id: "m", calls: [
    { id: "first", name: "powershell", input: full.slice(0, 512), inputLength: full.length },
    { id: "second", name: "read", input: short, inputLength: short.length },
  ] };
  const actual = await hydrateToolCalls(message, async (p: any) => {
    assert.equal(p.callId, "first"); return { text: full, totalLength: full.length, revision: createHash("sha256").update(full).digest("hex") };
  });
  assert.deepEqual(actual.map((c: any) => [c.id, c.messageId]), [["first", "m"], ["second", "m"]]);
});

test("Kiro write/read evidence permits real intermediate repair but checks the final read", () => {
  const repaired = toolRecord(
    { ...writeStep, status: "failed" },
    writeStep,
    { ...receiptStep, text: "invalid-json" },
    writeStep,
    receiptStep,
  );
  assertControlledTools("long-10-write-read", repaired, context);
});

test("Kiro write/read evidence cannot hide a corrupted final read behind an earlier good one", () => {
  assert.throws(() => assertControlledTools("long-10-write-read", toolRecord(writeStep, receiptStep, writeStep, { ...receiptStep, text: "invalid-json" }), context));
  assert.throws(() => assertControlledTools("long-10-write-read", toolRecord(writeStep, receiptStep, { ...receiptStep, status: "failed" }), context));
});

test("Kiro tool evidence accepts an explicit portable cwd for relative fixture paths", () => {
  const portable = { root: "/owned/project/fixtures", cwd: "/owned/project", modelId: "auto" };
  const relative = toolRecord({ ...csvStep, input: { path: "fixtures/inventory.csv" } });
  assertControlledTools("long-02-read", relative, portable);
  assert.throws(() => assertControlledTools("long-02-read", relative, { ...portable, cwd: "/other/project" }));
});

test("Kiro code review parses complete sum definitions without evaluating model source", () => {
  const sources = ["function sum(xs){return xs.reduce((a,x)=>a+x,0)}", "const sum = xs => xs.reduce((acc,item)=>acc+item,0);", "function sum(xs){return xs.reduce(function(a,x){return a+x;},0);}"];
  for (const code of sources) assertControlledAnswer("long-13-code-review", { answer: JSON.stringify({ code, total: 56 }) });
});

test("Kiro code review rejects comment/string lookalikes, invalid or incomplete repairs and extra execution", () => {
  const marker = globalThis as unknown as Record<string, unknown>; marker.KIRO_SHOULD_NOT_RUN = false;
  const sources = ["// xs.reduce((a,x)=>a+x,0)", "(a,x)=>a+x,0", '"xs.reduce((a,x)=>a+x,0)"', "function sum(xs){return 1} // xs.reduce((a,x)=>a+x,0)", "function sum(xs){return xs.reduce((a,x)=>a+x,0)", "function sum(xs){return xs.reduce((a,x)=>a+x,1)}", "function sum(xs){return xs.reduce((a,x)=>x-a,0)}", "globalThis.KIRO_SHOULD_NOT_RUN=true;function sum(xs){return xs.reduce((a,x)=>a+x,0)}", "function sum(xs){return xs.reduce(function(a,a){return a+a;},0)}", "function sum(xs?){return xs.reduce((a,x)=>a+x,0)}", "function sum<T>(xs){return xs.reduce((a,x)=>a+x,0)}", "const sum: Function = xs => xs.reduce((a,x)=>a+x,0);", "function sum(xs){return xs.reduce<number>((a,x)=>a+x,0)}"];
  try { for (const code of sources) assert.throws(() => assertControlledAnswer("long-13-code-review", { answer: JSON.stringify({ code, total: 56 }) }), { name: "AssertionError" }); assert.equal(marker.KIRO_SHOULD_NOT_RUN, false); }
  finally { delete marker.KIRO_SHOULD_NOT_RUN; }
});

test("Kiro write evidence recognizes quoted target arguments in supported write requests", () => {
  const path = context.receiptPath;
  for (const command of [`Set-Content -LiteralPath \'${path}\' -Value \'{}\'`, `\'{}\' | Out-File -Encoding utf8 -FilePath "${path}"`, `[System.IO.File]::WriteAllText(\'${path}\', \'{}\')`]) {
    assertControlledTools("long-10-write-read", toolRecord({ ...writeStep, input: { command } }, receiptStep), context);
  }
});

test("Kiro write evidence rejects path-only, comment, string and wrong-target lookalikes", () => {
  const path = context.receiptPath;
  for (const command of [`Write-Output \'${path}\'`, `# Set-Content -Path \'${path}\' -Value \'{}\'\nWrite-Output ok`, `Write-Output "Set-Content -Path \'${path}\'"`, `Write-Output "; Set-Content -Path \'${path}\'"`, `Set-Content -Path \'C:/other.json\' -Value \'${path}\'`, `[IO.File]::WriteAllText(\'C:/other.json\', \'${path}\')`, "Set-Content -Path __KIRO_TARGET__ -Value \'{}\'", "Set-Content -Path __kiro_target__ -Value \'{}\'", "[IO.File]::WriteAllText(__KIRO_TARGET__, \'{}\')"]) {
    assert.throws(() => assertControlledTools("long-10-write-read", toolRecord({ ...writeStep, input: { command } }, receiptStep), context), { name: "AssertionError" });
  }
});

test("Kiro controlled prompts make numeric JSON types and bare checksum output explicit without answers", () => {
  const typed = controlledPrompt("long-06-large-attachment", "Read the attachment", true);
  assert.match(typed, /JSON number/); assert.doesNotMatch(typed, /318|427|703|1555/);
  const checksum = controlledPrompt("long-20-checksum", "Compute the checksum", true);
  assert.match(checksum, /裸文本/); assert.match(checksum, /不要JSON/); assert.doesNotMatch(checksum, /1555/);
  const code = controlledPrompt("long-13-code-review", "Repair the function", true);
  assert.match(code, /完整sum函数/); assert.doesNotMatch(code, /初值0|初始值0|,\\s*0|703|1555/);
});
