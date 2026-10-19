import type { ChatMessage } from "./agent.js";

export type ToolCall = NonNullable<ChatMessage["calls"]>[number];
export type ToolStatus = NonNullable<ChatMessage["status"]> | "unknown";
export const toolStatusLabels: Record<ToolStatus, string> = {
  running: "执行中", completed: "已完成", failed: "失败", cancelled: "已停止", unknown: "未确认完成",
};
export type ToolIcon = "read" | "edit" | "write" | "bash" | "search" | "web" | "agents" | "delegate" | "append" | "cancel" | "result" | "tool";
const tools: Record<string, ToolIcon> = {
  read: "read",
  edit: "edit",
  write: "write",
  powershell: "bash",
  bash: "bash",
  pwsh: "bash",
  grep: "search",
  find: "search",
  ls: "search",
  web_search: "search",
  source_check: "search",
  fetch_content: "web",
  get_search_content: "web",
  delegate: "delegate",
  append: "append",
  cancel_task: "cancel",
  read_result: "result",
};
export function compactText(text: string, limit = 160) {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > limit ? `${line.slice(0, limit)}…` : line;
}
export function toolSummary(call: ToolCall): { label: string; icon: ToolIcon; target: string; detail: string } {
  if (call.summary) return call.summary;
  const name = call.name.replace(/^functions\./, "");
  const label = name === "powershell" ? "bash" : compactText(name) || "tool";
  const icon = Object.hasOwn(tools, name) ? tools[name] : "tool";
  let input: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(call.input);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw Error();
    input = parsed as Record<string, unknown>;
  } catch {
    return { label, icon, target: compactText(call.input) || "等待输入参数", detail: "" };
  }
  const text = (...keys: string[]) => keys.map((key) => input[key]).find((v) => typeof v === "string" && v.trim()) as string | undefined;
  const list = (key: string) => Array.isArray(input[key]) ? input[key].filter((v) => typeof v === "string" && v.trim()).join(" · ") : "";
  const path = text("path", "file_path");
  let target = path || text("command", "cmd", "pattern", "query", "url", "taskId", "description", "tool", "search") || list("queries") || list("urls");
  let detail = "";
  if (icon === "bash") target = text("command", "cmd") || target;
  if (icon === "search") {
    target = text("pattern", "query", "search") || list("queries") || target;
    if (path && target !== path) detail = path;
  }
  if (icon === "web") target = text("url") || list("urls") || target;
  if (name === "read") {
    const image = path && /\.(?:png|jpe?g|gif|webp|bmp)$/i.test(path);
    if (!image) {
      const positiveInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
      const offset = input.offset === undefined ? 1 : input.offset;
      if (positiveInteger(offset)) {
        if (positiveInteger(input.limit) && Number.isSafeInteger(offset + input.limit - 1)) detail = `L${offset}–${offset + input.limit - 1}`;
        else if (offset > 1) detail = `从 L${offset} 开始`;
      }
    }
  }
  if (name === "edit") detail = Array.isArray(input.edits) ? `${input.edits.length} 处替换` : typeof input.oldText === "string" && typeof input.newText === "string" ? "1 处替换" : "文本替换";
  if (name === "write" && typeof input.content === "string") detail = `${input.content.split("\n").length} 行`;
  if (name === "delegate" && Array.isArray(input.tasks)) {
    target = input.tasks.map((task) => task && typeof task === "object" && typeof task.task === "string" ? task.task : "子任务").join(" · ");
    detail = `${input.tasks.length} 个任务`;
  }
  if (!target) target = Object.keys(input).length ? compactText(call.input) : "无输入参数";
  return { label, icon, target: compactText(target, 240), detail: compactText(detail) };
}
export function toolPreview(result: ChatMessage | null) {
  if (!result) return "等待执行结果";
  if (result.preview !== undefined) return result.preview;
  if (result.status === "cancelled") return compactText(result.error || result.text) || "执行已停止，未确认的副作用需核实";
  const lines = (result.error || result.text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (result.status === "failed") return compactText(lines.find((line) => /error|failed|exception|错误|失败/i.test(line)) || lines[0] || "工具执行失败");
  return compactText(lines[0] || (result.status === "running" ? "正在执行，等待输出" : "未记录文本输出"));
}
