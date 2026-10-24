import { footnoteDefinition } from "./markdown.js";
import { memoryOutline, type MemoryNode, type MemoryState } from "./memory-outline.js";
export { memoryInstruction } from "./memory-instruction.js";
import type { Scope } from "./protocol.js";
import type { Selection } from "./agent.js";

export interface MemoryPreferences {
  topicNameReviewThresholdChars: number;
  queryModel: Selection | null; organizerModel: Selection | null; intervalMs: number;
  timeoutMs: number; readChars: number; maxTurns: number; concurrency: number; queue: number;
}
export const defaultMemoryPreferences: MemoryPreferences = {
  topicNameReviewThresholdChars: 2000,
  queryModel: null, organizerModel: null, intervalMs: 300000, timeoutMs: 300000,
  readChars: 240000, maxTurns: 32, concurrency: 12, queue: 32,
};
export const memoryBudgetLimits = {
  timeoutMs: { min: 1000, max: 3600000 }, readChars: { min: 16000, max: 1000000 }, maxTurns: { min: 1, max: 128 },
} as const;
export const memoryIncompleteMessages = {
  read_limit: "读取字符预算已到，请在记忆设置中提高读取上限后重试",
  turn_limit: "模型交互轮数已到，请在记忆设置中提高交互轮数后重试",
  read_failed: "资料读取失败，请检查来源是否可读后重试",
  output_limit: "结果超过 32,000 字符，请减少单次整理内容后重试",
  model_output_limit: "模型输出达到上限，请调整模型输出配置或减少单次整理内容后重试",
} as const;
export type MemoryIncompleteReason = keyof typeof memoryIncompleteMessages;
export interface MemoryExecutionResult { answer: string; incomplete: boolean; incompleteReason?: MemoryIncompleteReason }

export const memoryTitleMaxChars = 30;
export const memorySummaryMaxChars = 200;
/** Titles and summaries form the two-level navigation index. */
export const memorySummaryVersion = 3;
export function validMemorySummary(entry: { title: string; summary: string; summaryVersion?: number }) {
  return entry.summaryVersion === memorySummaryVersion && !!entry.title.trim() && !/[\r\n]/.test(entry.title) &&
    Array.from(entry.title).length <= memoryTitleMaxChars && !!entry.summary.trim() && Array.from(entry.summary).length <= memorySummaryMaxChars;
}
export const memoryScope = (scope: Scope) => `memory:${scope.workspaceId}:${scope.sessionId}`;
export const memoryCatalogScope = (workspaceId: string) => `memory-catalog:${workspaceId}`;
export const memoryOrganizationScope = (workspaceId: string) => `memory-organization:${workspaceId}`;
/** The latest explicitly requested organization in this workspace, retained across reconnects. */
export interface MemoryOrganization {
  id: string; workspaceId: string; sessionId?: string;
  status: "running" | "completed" | "partial" | "failed" | "cancelled" | "interrupted";
  total: number; processed: number; succeeded: number; failed: number; skipped: number;
  startedAt: number; endedAt: number | null; error?: string;
}
/** Client and service use the same UTF-8 ceiling before submitting an editable document. */
export const memoryEditBudgetBytes = 180_000;
export const memoryTemplate = "";
/** Only for recognizing historical placeholders; never used to initialize new memory. */
export const legacyMemoryTemplate = `# 会话记忆

## 目标与范围
尚未记录

## 要求与约束
尚未记录

## 任务进度
整体状态：尚未记录
整体进度：待评估
当前进展：尚未记录

任务状态使用：- [已完成]、- [进行中]、- [未开始]、- [阻塞]，其后填写任务标题。

## 简要过程
尚未记录

## 结论与决定
尚未记录

## 验证情况
尚未记录

## 下一步与接续位置
尚未记录

## 资料导航
按需用文字说明资料用途，正文使用脚注标记，详细地址放在文末引用中。
`;
export interface MemoryTask { title: string; state: MemoryState; abandoned?: boolean; waiting?: boolean; depth?: number; line?: number }
export interface MemoryProgress {
  goal: string; state: string; stateDetail?: string; current: string; next: string;
  percent: number | null; progressState: "valid" | "unknown" | "conflict";
  tasks: MemoryTask[]; overLimit: boolean; title?: string; outline?: MemoryNode[]; format?: "legacy" | "chapters"; complete?: boolean;
}
export interface MemoryFile { path: string; revision: string; size: number; updatedAt: number }
/**
 * Optional memory never blocks the primary task. These reasons let callers present
 * the current availability without treating a missing source as a completed read.
 */
export type MemoryReason = "missing" | "unavailable" | "correction_pending" | "timeout" | "revision_conflict" | "read_failed";
export interface MemoryView extends Scope {
  revision: string; entry: string; progress: MemoryProgress; files: MemoryFile[];
  deleted: boolean; error?: string; reason?: MemoryReason;
}
export interface MemoryDocument extends MemoryFile { content: string; offset: number; nextOffset: number | null; image?: string; available?: boolean; reason?: MemoryReason }
/** Optional memory reads expose no content when a source cannot be used. */
export function emptyMemoryView(scope: Scope): MemoryView {
  return { ...scope, revision: "empty", entry: "", progress: parseMemory(""), files: [], deleted: false };
}
export function emptyMemoryDocument(path: string): MemoryDocument {
  return { path, revision: "", size: 0, updatedAt: 0, content: "", offset: 0, nextOffset: null, available: false };
}
export interface MemoryCatalogEntry extends Scope {
  processingId?: string;
  id: string; title: string; sourceTitle?: string; summary: string; excerpt: string; hasContent: boolean; entryChars: number | null; keywords: string[]; revision: string;
  updatedAt: number; indexedAt: number | null; status: "pending" | "indexing" | "ready" | "error";
  deleted: boolean; error?: string; reason?: MemoryReason;
}
export interface MemoryReadDocument { sessionId: string; path: string; revision: string }
/** `sources` identifies the sources actually read; `readDocuments` records successful document reads. */
export interface MemoryQueryResult extends MemoryExecutionResult {
  processingId?: string;
  scope: Scope; sources: Array<Pick<MemoryCatalogEntry, "sessionId" | "revision">>;
  reason?: Extract<MemoryReason, "unavailable" | "timeout" | "revision_conflict" | "read_failed">;
  readDocuments?: MemoryReadDocument[];
}
const templateLines = new Set(legacyMemoryTemplate.split(/\r?\n/).map((line) => line.trim()));
/** A literal excerpt, not a generated summary. Ignore only headings and known empty-template lines. */
export function memoryExcerpt(content: string): string {
  const paragraphs = memoryBody(content).split(/\r?\n\s*\r?\n/).map((paragraph) => paragraph.split(/\r?\n/)
    .map((line) => line.trim()).filter((line) => line && !/^#{1,6}\s/.test(line) && !templateLines.has(line)).join(" "));
  return (paragraphs.find(Boolean) ?? memoryDocumentTitle(content)).replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").slice(0, 240);
}
export function memoryBody(content: string): string {
  // 示例、注释和脚注定义不构成任务事实。保留换行及栏目边界。
  const withoutComments = content.replace(/<!--[\s\S]*?(?:-->|$)/g, (value) => value.replace(/[^\r\n]/g, " "));
  let fence: { marker: "`" | "~"; length: number } | null = null;
  let footnoteLines = 0;
  return withoutComments.split(/\r?\n/).map((line, index, lines) => {
    if (footnoteLines > 0) { footnoteLines--; return " ".repeat(line.length); }
    const opening = line.match(/^[ \t]{0,3}(`{3,}|~{3,})(?:[^\r\n]*)$/)?.[1];
    if (!fence && opening) { fence = { marker: opening[0] as "`" | "~", length: opening.length }; return " ".repeat(line.length); }
    if (!fence) {
      if (/^ {0,3}\[\^[^\]\s]+\]:/.test(line)) {
        const definition = footnoteDefinition(lines.slice(index).join("\n"));
        if (definition) {
          footnoteLines = definition.raw.split("\n").length - (definition.raw.endsWith("\n") ? 2 : 1);
          return " ".repeat(line.length);
        }
      }
      return line.replace(/\[\^[^\]\s]+\]/g, "");
    }
    const closing = line.match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/)?.[1];
    if (closing && closing[0] === fence.marker && closing.length >= fence.length) fence = null;
    return " ".repeat(line.length);
  }).join("\n");
}
function parseLegacyMemory(content: string): MemoryProgress {
  const parseableContent = memoryBody(content);
  const section = (...headings: string[]) => {
    for (const heading of headings) {
      const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = parseableContent.match(new RegExp(`^##\\s+${escaped}\\s*\\r?\\n([\\s\\S]*?)(?=^##\\s+|$(?![\\s\\S]))`, "m"));
      if (match) return match[1].trim();
    }
    return "";
  };
  const canonicalGoal = section("目标与范围");
  const compatibleGoal = section("目标与状态", "当前目标与状态", "目标与约束");
  // 兼容旧入口时只取明确目标行，避免把状态、证据和整节正文塞进 Todo 标题。
  const compatibleGoalLine = compatibleGoal.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
  const goal = canonicalGoal || compatibleGoalLine.replace(/(?:[；;。]?\s*)(?:整体状态|整体进度|当前进展|下一步)[：:][\s\S]*$/, "").trim();
  const progress = section("任务进度", "任务清单", "TodoList", "待办事项", "待办");
  const field = (name: string, full: boolean, ...sources: string[]) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Keep all sentences in task status and next actions, including waiting conditions.
    const valuePattern = full ? "([^\\r\\n]+?)(?=[；;。]\\s*(?:整体状态|整体进度|当前进展|下一步)[：:]|$)" : "([^\\r\\n；;。]+)";
    const pattern = new RegExp(`(?:^|[\\r\\n；;。])\\s*${escaped}[：:][ \\t]*${valuePattern}`, "m");
    for (const source of sources) {
      const value = source.match(pattern)?.[1].trim();
      if (value) return value;
    }
    return "";
  };
  const rawState = field("整体状态", true, progress, compatibleGoal, canonicalGoal);
  const state = rawState.match(/^(已完成|进行中|未开始|等待|已放弃|阻塞|尚未记录)(?=$|[（(\s；;。])/)?.[1] ?? rawState;
  // 任务只来自明确的任务栏目与 checkbox；正文项目符号和 Markdown 链接不是 Todo。
  const tasks: MemoryTask[] = memoryOutline(progress).nodes.filter(node => node.state).map(node => ({
    state: node.state!, title: node.title, ...(node.abandoned ? { abandoned: true } : {}), ...(node.waiting ? { waiting: true } : {}),
  }));
  const activeTasks = tasks.filter(task => !task.abandoned);
  const estimate = field("整体进度", false, progress, compatibleGoal, canonicalGoal), match = /^(约\s*)?(\d+)%$/.exec(estimate);
  const value = match ? Number(match[2]) : null;
  const complete = state === "已完成";
  const valid = value !== null && value >= 0 && value <= 100 && value % 10 === 0 &&
    (value === 100 ? complete && !match?.[1] && activeTasks.length > 0 && activeTasks.every((t) => t.state === "已完成" && !t.waiting) : !complete);
  return { goal, state, ...(rawState !== state ? { stateDetail: rawState } : {}), current: field("当前进展", true, progress, compatibleGoal, canonicalGoal),
    next: section("下一步与接续位置", "下一步") || field("下一步", true, progress, compatibleGoal, canonicalGoal, parseableContent),
    percent: valid ? value : null, progressState: valid ? "valid" : !estimate || estimate === "待评估" ? "unknown" : "conflict",
    tasks, overLimit: [...content].length > 2000 };
}
export function memoryDocumentTitle(content: string) {
  const title = memoryOutline(memoryBody(content)).title;
  return title === "会话记忆" ? "" : title;
}
export function parseMemory(content: string): MemoryProgress {
  const body = memoryBody(content), outline = memoryOutline(body);
  const legacy = /^##\s+(?:任务进度|任务清单|TodoList|待办事项|待办|目标与范围|目标与状态|当前目标与状态|目标与约束)\s*$/m.test(body) &&
    (!memoryDocumentTitle(content) || /^##\s+(?:任务进度|任务清单|TodoList|待办事项|待办)\s*\r?\n(?:(?!^#{1,2}\s)[\s\S])*?^整体(?:状态|进度)[：:]/m.test(body));
  if (legacy) {
    const progress = parseLegacyMemory(content);
    return { ...progress, title: memoryDocumentTitle(content), format: "legacy", outline: outline.nodes,
      complete: progress.state === "已完成" && progress.progressState !== "conflict" && progress.tasks.some(task => !task.abandoned) && progress.tasks.filter(task => !task.abandoned).every(task => task.state === "已完成" && !task.waiting) };
  }
  const tasks = outline.nodes.filter(node => node.state).map(node => ({ title: node.title, state: node.state!, abandoned: node.abandoned, waiting: node.waiting, depth: node.depth, line: node.line }));
  const active = tasks.filter(task => !task.abandoned);
  const complete = active.length > 0 && active.every(task => task.state === "已完成" && !task.waiting);
  const actionable = active.filter(task => !task.waiting && (task.state === "进行中" || task.state === "未开始"));
  const state = complete ? "已完成" : actionable.some(task => task.state === "进行中") ? "进行中" : actionable.length ? "未开始" : active.some(task => task.waiting) ? "等待" : active.some(task => task.state === "失败") ? "失败" : tasks.length ? "已放弃" : "";
  return { goal: memoryDocumentTitle(content), title: memoryDocumentTitle(content), state, current: actionable.find(task => task.state === "进行中")?.title ?? "",
    next: actionable.find(task => task.state === "未开始")?.title ?? "", percent: null, progressState: "unknown", tasks,
    outline: outline.nodes, format: "chapters", complete, overLimit: false };
}
export function memoryComplete(progress: MemoryProgress) {
  return progress.complete ?? (progress.state === "已完成" && progress.progressState !== "conflict" && progress.tasks.some(task => !task.abandoned) && progress.tasks.filter(task => !task.abandoned).every(task => task.state === "已完成" && !task.waiting));
}
/** Applied at controlled write boundaries. Historical long titles remain readable. */
export function assertMemoryTitle(previous: string, next: string) {
  const before = memoryDocumentTitle(previous), after = memoryDocumentTitle(next);
  if (before && before !== after) throw Error("记忆标题生成后不能修改；新目标请记录在正文中");
  if (!before && [...after].length > 13) throw Error("初始记忆标题不能超过13字");
}
