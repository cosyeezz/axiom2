import assert from "node:assert/strict";
import { test } from "node:test";
import { memoryQueryTool } from "../src/server/memory-tool.js";
import * as memoryTools from "../src/server/memory-tool.js";
import { chatMessage } from "../src/server/transcript.js";
import type { MemoryQueryResult } from "../src/shared/memory.js";

const params = { question: "如何修复配置加载？" };
// This tool never reads the host context.
const context = {} as Parameters<ReturnType<typeof memoryQueryTool>["execute"]>[4];
function result(patch: Partial<MemoryQueryResult> = {}): MemoryQueryResult {
  return {
    answer: "修改 src/config.ts 的 loadConfig，然后运行 `npm test`。仅适用于 v2。",
    scope: { workspaceId: "internal-workspace", sessionId: "internal-session" },
    incomplete: false,
    sources: [{ sessionId: "internal-source", revision: "internal-revision" }],
    readDocuments: [{ sessionId: "internal-source", path: "references/internal.md", revision: "internal-revision" }],
    processingId: "internal-processing",
    ...patch,
  };
}
async function execute(details: unknown) {
  return memoryQueryTool(async () => details).execute("query-call", params, undefined, undefined, context);
}

test("memory tool returns actionable text without audit metadata and retains full details", async () => {
  const details = result(), controller = new AbortController();
  const tool = memoryQueryTool(async (id, input, signal) => {
    assert.equal(id, "query-call"); assert.equal(input, params); assert.equal(signal, controller.signal);
    return details;
  });
  const output = await tool.execute("query-call", params, controller.signal, undefined, context);
  assert.deepEqual(output.content, [{ type: "text", text: details.answer }]);
  assert.equal(output.details, details);
  const projected = chatMessage({ role: "toolResult", toolName: "memory_query", toolCallId: "query-call", ...output }, "message");
  assert.equal(projected?.text, details.answer);
  assert.ok(!JSON.stringify(projected).includes("internal-"));
});

test("empty successful answers do not dump the list of read sources", async () => {
  for (const answer of ["", " \n\t "]) {
    const details = result({ answer });
    const output = await execute(details);
    assert.deepEqual(output.content, [{ type: "text", text: "未找到相关记忆。" }]);
    assert.equal(output.details, details);
  }
});

for (const [reason, expected] of [
  ["unavailable", "查询暂不可用"], ["timeout", "查询超时"],
  ["revision_conflict", "来源已变化"], ["read_failed", "资料读取失败"], ["locator_invalid", "目的定位已失效"],
] as const) test(`memory tool distinguishes ${reason} from no match`, async () => {
  const output = await execute(result({ answer: "", incomplete: true, reason }));
  assert.ok(output.content[0].type === "text");
  const text = output.content[0].text;
  assert.match(text, /记忆查询未完成/); assert.ok(text.includes(expected));
  assert.doesNotMatch(text, /未找到|internal-/);
});

for (const incompleteReason of [undefined, "read_limit", "turn_limit", "output_limit", "model_output_limit"] as const)
  test(`partial answers retain useful content and mark ${incompleteReason ?? "unknown incompleteness"}`, async () => {
    const details = result({ incomplete: true, incompleteReason });
    const output = await execute(details);
    assert.ok(output.content[0].type === "text");
    const text = output.content[0].text;
    assert.match(text, /记忆查询未完成/); assert.match(text, /部分结果/);
    assert.ok(text.endsWith(details.answer)); assert.doesNotMatch(text, /internal-/);
    assert.equal(output.details, details);
  });

test("query text preserves necessary detail instead of silently cutting it at a fixed length", async () => {
  const answer = `${"配置项与适用条件。".repeat(250)}\n关键限制：仅适用于 v2。`;
  assert.deepEqual((await execute(result({ answer }))).content, [{ type: "text", text: answer }]);
});

test("only historical query is exposed; details use native file tools", () => {
  assert.deepEqual(Object.keys(memoryTools), ["memoryQueryTool"]);
});

test("invalid responses and execution failures cannot look like an empty match", async () => {
  for (const details of [null, undefined, [], {}, { answer: "" }, { answer: 42, incomplete: false }])
    await assert.rejects(execute(details), /记忆查询返回格式无效/);
  const failure = new Error("query transport failed");
  await assert.rejects(memoryQueryTool(async () => { throw failure; }).execute("query-call", params, undefined, undefined, context), error => error === failure);
});
