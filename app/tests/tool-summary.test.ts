import assert from "node:assert/strict";
import { test } from "node:test";
import { toolPreview, toolSummary, toolStatusLabels } from "../src/client/chat/tool-summary.js";
const call = (name: string, input: unknown) => ({ id: "call", name, input: JSON.stringify(input) });
test("tool summaries prioritize paths, commands and actual input metadata", () => {
  assert.deepEqual(toolSummary(call("read", { path: "src/main.ts", offset: 20, limit: 10 })), { label: "读取文件", icon: "read", target: "src/main.ts", detail: "L20–29" });
  assert.equal(toolSummary(call("edit", { path: "src/main.ts", edits: [{ oldText: "a", newText: "b" }, { oldText: "c", newText: "d" }] })).detail, "2 处替换");
  assert.equal(toolSummary(call("write", { path: "test.txt", content: "a\nb" })).detail, "2 行");
  assert.equal(toolSummary(call("powershell", { command: "npm test\n npm run build" })).target, "npm test npm run build");
  assert.equal(toolSummary(call("delegate", { tasks: [{ task: "审查" }, { task: "测试" }] })).detail, "2 个任务");
  assert.equal(toolSummary(call("append", { taskId: "task-a", text: "more" })).target, "task-a");
});
test("unknown tools and partial JSON remain inspectable and bounded", () => {
  assert.equal(toolSummary(call("custom", { query: "needle" })).target, "needle");
  assert.equal(toolSummary(call("custom", {})).target, "无输入参数");
  assert.equal(toolSummary(call("functions.read", { path: "README.md" })).label, "读取文件");
  assert.equal(toolSummary(call("constructor", {})).label, "constructor");
  assert.equal(toolSummary({ id: "x", name: "read", input: '{"path":' }).target, '{"path":');
  assert.ok(toolSummary(call("bash", { command: "x".repeat(1000) })).target.length <= 241);
  assert.equal(toolSummary(call("custom", null)).target, "null");
});
test("tool labels describe actions in Chinese while icons retain tool categories", () => {
  const mappings = [
    ["read", "read", "读取文件"], ["edit", "edit", "编辑文件"], ["write", "write", "写入文件"],
    ["powershell", "bash", "执行命令"], ["bash", "bash", "执行命令"], ["pwsh", "bash", "执行命令"],
    ["grep", "search", "搜索文本"], ["find", "search", "查找文件"], ["ls", "search", "列出目录"],
    ["memory_query", "tool", "查询记忆"],
    ["web_search", "search", "搜索网页"], ["source_check", "search", "核查来源"],
    ["fetch_content", "web", "读取网页"], ["get_search_content", "web", "读取搜索结果"],
    ["delegate", "delegate", "委派子任务"], ["append", "append", "补充子任务"],
    ["cancel_task", "cancel", "停止子任务"], ["read_result", "result", "读取子任务结果"],
  ];
  for (const [name, icon, label] of mappings) {
    for (const toolName of [name, `functions.${name}`]) {
      const summary = toolSummary(call(toolName, {}));
      assert.equal(summary.label, label, toolName);
      assert.equal(summary.icon, icon, toolName);
    }
  }
  assert.deepEqual(toolSummary(call("powershell", { path: "C:/work", command: "Get-Content file.txt" })), {
    label: "执行命令", icon: "bash", target: "Get-Content file.txt", detail: "",
  });
  assert.equal(toolSummary(call("bash", { cmd: "rg needle" })).label, "执行命令");
});
test("image summaries retain the read name and file summaries only describe valid line ranges", () => {
  for (const extension of ["png", "JPG", "jpeg", "gif", "webp", "bmp"]) {
    assert.deepEqual(toolSummary(call("functions.read", { file_path: `C:\\images\\shot.${extension}`, offset: 10, limit: 20 })), {
      label: "读取文件", icon: "read", target: `C:\\images\\shot.${extension}`, detail: "",
    });
  }
  assert.equal(toolSummary(call("read", { path: "shot.png.ts" })).label, "读取文件");
  assert.equal(toolSummary(call("read", { path: "a.ts", limit: 5 })).detail, "L1–5");
  assert.equal(toolSummary(call("read", { path: "a.ts", offset: 20 })).detail, "从 L20 开始");
  for (const offset of [0, -1, 1.5, "20", null]) {
    assert.equal(toolSummary(call("read", { path: "a.ts", offset, limit: 10 })).detail, "");
  }
  for (const limit of [0, -1, 1.5, "20", null]) {
    assert.equal(toolSummary(call("read", { path: "a.ts", limit })).detail, "");
  }
  assert.equal(toolSummary(call("edit", { path: "a.ts", oldText: "a", newText: "b" })).detail, "1 处替换");
  assert.equal(toolSummary(call("edit", { path: "a.ts", edits: [] })).detail, "0 处替换");
  assert.equal(toolSummary(call("edit", { path: "a.ts" })).detail, "文本替换");
  assert.equal(toolSummary(call("write", { path: "a.ts", content: "a\r\nb" })).detail, "2 行");
});
test("search and web summaries retain queries, URLs and search scope", () => {
  assert.deepEqual(toolSummary(call("grep", { path: "src", pattern: "toolSummary" })), {
    label: "搜索文本", icon: "search", target: "toolSummary", detail: "src",
  });
  assert.equal(toolSummary(call("web_search", { queries: ["first", null, {}, "second"] })).target, "first · second");
  assert.equal(toolSummary(call("fetch_content", { urls: ["https://example.com", "https://example.org"] })).target, "https://example.com · https://example.org");
  assert.equal(toolSummary(call("read", { path: "", file_path: "fallback.ts" })).target, "fallback.ts");
  assert.equal(toolSummary(call("delegate", { tasks: [null, { title: "测试", task: "完整测试要求" }] })).target, "子任务 · 测试");
});
test("cached English summaries are localized without losing full-input metadata", () => {
  const summary = { label: "read", icon: "read" as const, target: "src/full-path.ts", detail: "L20–29" };
  const cached = { id: "cached", name: "functions.read", input: '{"path":', summary };
  assert.deepEqual(toolSummary(cached), { ...summary, label: "读取文件" });
  assert.equal(cached.summary.label, "read", "display localization does not mutate stored calls");
});
test("fallback summaries always supply safe, bounded labels and generic icons", () => {
  for (const name of ["custom", "constructor", "__proto__", "toString"]) {
    assert.deepEqual(toolSummary(call(name, {})), { label: name, icon: "tool", target: "无输入参数", detail: "" });
  }
  for (const name of ["", "functions.", "   "]) {
    assert.equal(toolSummary(call(name, {})).label, "调用工具");
  }
  assert.equal(toolSummary(call("functions.custom_tool", {})).label, "custom_tool");
  assert.ok(toolSummary(call("x".repeat(1000), {})).label.length <= 161);
  for (const input of ["", "{", "[]", "null", '"text"', "42"]) {
    const summary = toolSummary({ id: "x", name: "functions.read", input });
    assert.equal(summary.label, "读取文件");
    assert.equal(summary.icon, "read");
    assert.equal(summary.target, input || "等待输入参数");
  }
  assert.ok(toolSummary(call("custom", { nested: "x".repeat(1000) })).target.length <= 161);
  assert.ok(toolSummary(call("grep", { path: "x".repeat(1000), pattern: "needle" })).detail.length <= 161);
});
test("result previews keep failure, stop and unknown distinct from success", () => {
  assert.equal(toolPreview(null), "等待执行结果");
  assert.equal(toolStatusLabels.unknown, "未确认完成");
  assert.equal(toolStatusLabels.cancelled, "已停止");
  assert.equal(toolPreview({ id: "x", role: "toolResult", status: "failed", text: "started\nError: denied\nstack" }), "Error: denied");
  assert.match(toolPreview({ id: "x", role: "toolResult", status: "cancelled", text: "" }), /已停止/);
  assert.equal(toolPreview({ id: "x", role: "toolResult", status: "completed", text: "\nWritten test.ts\nmore" }), "Written test.ts");
});
