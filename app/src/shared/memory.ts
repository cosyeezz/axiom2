import { footnoteDefinition } from "./markdown.js";
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
export const memoryRules = `# 记忆文件组织规则

会话记忆以 MEMORY.md 为入口，全文最多 2,000 字，包含引用。详细资料、脚本和产物分别放入 references、scripts 和 artifacts 目录，按需使用。

正文用文字描述目标、要求、重要事实、决定、结果和当前状态。需要关联详细资料时使用脚注标记，将文件路径或其他详细地址放在文末引用中。例如正文使用 \`[^资料]\`，文末写 \`[^资料]: [资料说明](references/资料.md)\`。

保留“## 目标与范围”和“## 任务进度”栏目，其他内容按需组织。

任务进度包含整体状态、整体进度、当前进展和任务清单。任务使用“- [状态] 任务标题”，状态为未开始、进行中、阻塞或已完成。

整体进度以 10% 为步进。任务及必要验证全部完成时记为 100%。任务清单、整体状态和进度保持一致。
`;
export const memoryTemplate = `# 会话记忆

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
export interface MemoryTask { title: string; state: "已完成" | "进行中" | "未开始" | "阻塞" }
export interface MemoryProgress {
  goal: string; state: string; stateDetail?: string; current: string; next: string;
  percent: number | null; progressState: "valid" | "unknown" | "conflict";
  tasks: MemoryTask[]; overLimit: boolean;
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
const templateLines = new Set(memoryTemplate.split(/\r?\n/).map((line) => line.trim()));
/** A literal excerpt, not a generated summary. Ignore only headings and known empty-template lines. */
export function memoryExcerpt(content: string): string {
  const paragraphs = memoryBody(content).split(/\r?\n\s*\r?\n/).map((paragraph) => paragraph.split(/\r?\n/)
    .map((line) => line.trim()).filter((line) => line && !/^#{1,6}\s/.test(line) && !templateLines.has(line)).join(" "));
  return (paragraphs.find(Boolean) ?? "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").slice(0, 240);
}
function memoryBody(content: string): string {
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
export function parseMemory(content: string): MemoryProgress {
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
  const state = rawState.match(/^(已完成|进行中|未开始|阻塞|尚未记录)(?=$|[（(\s；;。])/)?.[1] ?? rawState;
  // 任务只来自明确的任务栏目与 checkbox；正文项目符号和 Markdown 链接不是 Todo。
  const tasks: MemoryTask[] = [...progress.matchAll(/^[\t ]*[-*+]\s+\[(已完成|进行中|未开始|阻塞|[xX ])\]\s+([^\r\n]+?)\s*$/gm)].map((match) => ({
    state: match[1] === "x" || match[1] === "X" ? "已完成" : match[1] === " " ? "未开始" : match[1] as MemoryTask["state"],
    title: match[2],
  }));
  const estimate = field("整体进度", false, progress, compatibleGoal, canonicalGoal), match = /^(约\s*)?(\d+)%$/.exec(estimate);
  const value = match ? Number(match[2]) : null;
  const complete = state === "已完成";
  const valid = value !== null && value >= 0 && value <= 100 && value % 10 === 0 &&
    (value === 100 ? complete && !match?.[1] && tasks.length > 0 && tasks.every((t) => t.state === "已完成") : !complete);
  return { goal, state, ...(rawState !== state ? { stateDetail: rawState } : {}), current: field("当前进展", true, progress, compatibleGoal, canonicalGoal),
    next: section("下一步与接续位置", "下一步") || field("下一步", true, progress, compatibleGoal, canonicalGoal, parseableContent),
    percent: valid ? value : null, progressState: valid ? "valid" : !estimate || estimate === "待评估" ? "unknown" : "conflict",
    tasks, overLimit: [...content].length > 2000 };
}
export function memoryInstruction(path: string, rulesPath: string) {
  return `你需要主动维护会话记忆文件 ${path}，记录本会话的重要要求、发现、决定、进展、结果和依据，帮助后续工作保持连贯，避免遗漏、误判和重复操作，并供其他会话复用相关经验。每次收到用户的新输入，包括运行中追加要求，先检查需要保留的信息并及时更新。执行中有信息新增或变化时，判断忘记后是否会造成误判、重复操作或重新调查，有保留价值就及时记录。记忆文件的组织与格式遵循 ${rulesPath}。首次维护前先读取规则，当前上下文缺少规则时重新查阅。记忆不可用时继续任务，不假称已读取或保存。

接续任务、上下文压缩后或当前背景不清时，先读取本会话记忆。程序会在会话开始时注入历史记忆的Topic目录，压缩后提供最新目录。目录表示可查询的记忆范围，名称本身不是事实结论。执行任务时，结合目录判断是否需要历史处理逻辑、决定或依据，需要时调用memory_query。每次只传一个目录提供的Topic标识和一个简短、自足的问题，保留必要对象、条件和版本，不粘贴整段对话。多个Topic或多个独立问题分别调用。已有信息充分时不重复查询，需要当前状态或新依据时重新查询。

查询结果是历史记录的归纳，不保证仍适用于当前任务。你负责核验其中与当前任务相关的错误或冲突，结合适用条件、当前证据和必要的授权核验判断，不仅凭时间先后、来源数量或语气选定结论。依据不足时保留分歧和待核验状态，不为记忆维护发起无关的全库核查。有充分依据纠正时，在本会话记忆中以“记忆纠正”标注原来源、原说法及适用范围、更正内容、核验依据和核验状态。当前文件的旧结论同步修正或注明替代关系，不直接改写其他会话来源。纠正由后续正常整理处理，无需立即回调查询工具、启动整理或单独汇报维护动作。若影响当前交付，应在答复中使用核验后的内容。

最终回复前，检查并更新本会话记忆，使任务清单、整体状态、整体进度与实际结果一致，不得仅凭“已完成”标记判断任务结束。当前任务范围内仍有已获授权且可继续推进的未完成项时，应继续处理。记忆更新、阶段汇报或写下“下一步”不能代替实际执行。构建或测试失败时，先核对当前错误并继续处理授权范围内可修复的问题，不能仅因报错位于本轮未修改的文件就判定阻塞；涉及并行修改时保留他人改动并核对最新状态。只有确实缺少用户输入、授权或外部条件，且没有可继续推进的工作时，才说明具体阻塞原因和所需条件后结束，不宣称完成。只有当前任务范围及必要验证全部完成，才能标为已完成和100%。一轮回复结束不等于整体完成，完成后继续新工作时恢复相应状态并更新记忆。交付先说明核心结果和关键变化，再补充必要细节，避免重复、流水账和无关展开，不为简短省略影响结论的重要限制。`;
}
