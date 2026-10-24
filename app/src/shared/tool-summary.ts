import type { ChatMessage } from "./agent.js";

export type ToolCall = NonNullable<ChatMessage["calls"]>[number];
export type ToolStatus = NonNullable<ChatMessage["status"]> | "unknown";
export const toolStatusLabels: Record<ToolStatus, string> = {
  running: "执行中", completed: "已完成", failed: "失败", cancelled: "已停止", unknown: "未确认完成",
};
export type ToolIcon = "read" | "edit" | "write" | "bash" | "search" | "web" | "memory" | "code" | "discovery" | "resources" | "templates" | "resource-read" | "agents" | "delegate" | "append" | "cancel" | "result" | "tool";
const tools: Record<string, { icon: ToolIcon; label: string }> = {
  read: { icon: "read", label: "读取文件" },
  edit: { icon: "edit", label: "编辑文件" },
  write: { icon: "write", label: "写入文件" },
  powershell: { icon: "bash", label: "执行命令" },
  bash: { icon: "bash", label: "执行命令" },
  pwsh: { icon: "bash", label: "执行命令" },
  grep: { icon: "search", label: "搜索文本" },
  find: { icon: "search", label: "查找文件" },
  ls: { icon: "search", label: "列出目录" },
  memory_query: { icon: "memory", label: "查询记忆" },
  codemode: { icon: "code", label: "执行代码" },
  tool_search: { icon: "discovery", label: "搜索工具" },
  list_mcp_resources: { icon: "resources", label: "列出 MCP 资源" },
  list_mcp_resource_templates: { icon: "templates", label: "列出 MCP 资源模板" },
  read_mcp_resource: { icon: "resource-read", label: "读取 MCP 资源" },
  web_search: { icon: "search", label: "搜索网页" },
  source_check: { icon: "search", label: "核查来源" },
  fetch_content: { icon: "web", label: "读取网页" },
  get_search_content: { icon: "web", label: "读取搜索结果" },
  delegate: { icon: "delegate", label: "委派子任务" },
  append: { icon: "append", label: "补充子任务" },
  cancel_task: { icon: "cancel", label: "停止子任务" },
  read_result: { icon: "result", label: "读取子任务结果" },
};
export function compactText(text: string, limit = 160) {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > limit ? `${line.slice(0, limit)}…` : line;
}
export function taskCallPreview(call: ToolCall): ToolCall["taskPreview"] {
  if (call.taskPreview) return call.taskPreview;
  const name = call.name.replace(/^functions\./, "");
  if (!["delegate", "append", "cancel_task", "read_result"].includes(name)) return undefined;
  try {
    const input = JSON.parse(call.input);
    if (!input || typeof input !== "object") return undefined;
    return {
      ...(typeof input.taskId === "string" ? { taskId: input.taskId.slice(0, 200) } : {}),
      // Display only the caller's explicit fields; legacy inputs get static labels.
      ...(Array.isArray(input.tasks) ? { titles: input.tasks.slice(0, 8).map((task: any) =>
        typeof task?.title === "string" && task.title.trim() ? task.title : "子任务") } : {}),
      ...(name === "cancel_task" && typeof input.reason === "string" && input.reason.trim() ? { reason: input.reason } : {}),
      ...(name === "append" ? { summary: typeof input.summary === "string" && input.summary.trim() ? input.summary : "补充任务" } : {}),
    };
  } catch { return undefined; }
}
export function toolSummary(call: ToolCall): { label: string; icon: ToolIcon; target: string; detail: string } {
  const name = call.name.replace(/^functions\./, "");
  const tool = Object.hasOwn(tools, name) ? tools[name] : undefined;
  const label = tool?.label ?? (compactText(name) || "调用工具");
  // Refresh known presentation metadata without reparsing truncated input snapshots.
  if (call.summary) return tool ? { ...call.summary, label, icon: tool.icon } : call.summary;
  const icon = tool?.icon ?? "tool";
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
  if (name === "memory_query") target = text("question") || target;
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
    target = taskCallPreview(call)?.titles?.join(" · ") ?? "";
    detail = `${input.tasks.length} 个任务`;
  }
  if (!target) target = Object.keys(input).length ? compactText(call.input) : "无输入参数";
  return { label, icon, target: compactText(target, 240), detail: compactText(detail) };
}
export function ordinaryToolStatus(message: ChatMessage, result: ChatMessage | null): ToolStatus {
  return result?.status ?? (message.status === "failed" || message.status === "cancelled" ? message.status : "unknown");
}
export function toolPreview(result: ChatMessage | null) {
  if (!result) return "等待执行结果";
  if (result.preview !== undefined) return result.preview;
  if (result.status === "cancelled") return compactText(result.error || result.text) || "执行已停止，未确认的副作用需核实";
  const lines = (result.error || result.text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (result.status === "failed") return compactText(lines.find((line) => /error|failed|exception|错误|失败/i.test(line)) || lines[0] || "工具执行失败");
  return compactText(lines[0] || (result.status === "running" ? "正在执行，等待输出" : "未记录文本输出"));
}
