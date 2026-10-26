import { footnoteDefinition } from "./markdown.js";
import { assertMemoryTreeEdit } from "./memory-detail-paths.js";
import { memoryOutline } from "./memory-outline.js";
import { analyzeMemoryTasks } from "./memory-task-analysis.js";
export { memoryInstruction } from "./memory-instruction.js";
export const defaultMemoryPreferences = {
    queryModel: null, organizerModel: null, timeoutMs: 300000,
    readChars: 240000, maxTurns: 32, concurrency: 12, queue: 32,
};
export const memoryBudgetLimits = {
    timeoutMs: { min: 1000, max: 3600000 }, readChars: { min: 16000, max: 1000000 }, maxTurns: { min: 1, max: 128 },
};
export const memoryIncompleteMessages = {
    read_limit: "读取字符预算已到，请在记忆设置中提高读取上限后重试",
    turn_limit: "模型交互轮数已到，请在记忆设置中提高交互轮数后重试",
    read_failed: "资料读取失败，请检查来源是否可读后重试",
    output_limit: "结果超过 32,000 字符，请减少单次整理内容后重试",
    model_output_limit: "模型输出达到上限，请调整模型输出配置或减少单次整理内容后重试",
};
export const memoryScope = (scope) => `memory:${scope.workspaceId}:${scope.sessionId}`;
export const memoryCatalogScope = (workspaceId) => `memory-catalog:${workspaceId}`;
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
/** Optional memory reads expose no content when a source cannot be used. */
export function emptyMemoryView(scope) {
    return { ...scope, revision: "empty", entry: "", progress: parseMemory(""), files: [], deleted: false };
}
export function emptyMemoryDocument(path) {
    return { path, revision: "", size: 0, updatedAt: 0, content: "", offset: 0, nextOffset: null, available: false };
}
const templateLines = new Set(legacyMemoryTemplate.split(/\r?\n/).map((line) => line.trim()));
/** A literal excerpt, not a generated summary. Ignore only headings and known empty-template lines. */
export function memoryExcerpt(content) {
    const paragraphs = memoryBody(content).split(/\r?\n\s*\r?\n/).map((paragraph) => paragraph.split(/\r?\n/)
        .map((line) => line.trim()).filter((line) => line && !/^#{1,6}\s/.test(line) && !templateLines.has(line)).join(" "));
    return (paragraphs.find(Boolean) ?? memoryDocumentTitle(content)).replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").slice(0, 240);
}
export function memoryBody(content) {
    // 示例、注释和脚注定义不构成任务事实。保留换行及栏目边界。
    const withoutComments = content.replace(/<!--[\s\S]*?(?:-->|$)/g, (value) => value.replace(/[^\r\n]/g, " "));
    let fence = null;
    let footnoteLines = 0;
    return withoutComments.split(/\r?\n/).map((line, index, lines) => {
        if (footnoteLines > 0) {
            footnoteLines--;
            return " ".repeat(line.length);
        }
        const opening = line.match(/^[ \t]{0,3}(`{3,}|~{3,})(?:[^\r\n]*)$/)?.[1];
        if (!fence && opening) {
            fence = { marker: opening[0], length: opening.length };
            return " ".repeat(line.length);
        }
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
        if (closing && closing[0] === fence.marker && closing.length >= fence.length)
            fence = null;
        return " ".repeat(line.length);
    }).join("\n");
}
function parseLegacyMemory(content) {
    const parseableContent = memoryBody(content);
    const section = (...headings) => {
        for (const heading of headings) {
            const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const match = parseableContent.match(new RegExp(`^##\\s+${escaped}\\s*\\r?\\n([\\s\\S]*?)(?=^##\\s+|$(?![\\s\\S]))`, "m"));
            if (match)
                return match[1].trim();
        }
        return "";
    };
    const canonicalGoal = section("目标与范围");
    const compatibleGoal = section("目标与状态", "当前目标与状态", "目标与约束");
    // 兼容旧入口时只取明确目标行，避免把状态、证据和整节正文塞进 Todo 标题。
    const compatibleGoalLine = compatibleGoal.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
    const goal = canonicalGoal || compatibleGoalLine.replace(/(?:[；;。]?\s*)(?:整体状态|整体进度|当前进展|下一步)[：:][\s\S]*$/, "").trim();
    const progress = section("任务进度", "任务清单", "TodoList", "待办事项", "待办");
    const field = (name, full, ...sources) => {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // Keep all sentences in task status and next actions, including waiting conditions.
        const valuePattern = full ? "([^\\r\\n]+?)(?=[；;。]\\s*(?:整体状态|整体进度|当前进展|下一步)[：:]|$)" : "([^\\r\\n；;。]+)";
        const pattern = new RegExp(`(?:^|[\\r\\n；;。])\\s*${escaped}[：:][ \\t]*${valuePattern}`, "m");
        for (const source of sources) {
            const value = source.match(pattern)?.[1].trim();
            if (value)
                return value;
        }
        return "";
    };
    const rawState = field("整体状态", true, progress, compatibleGoal, canonicalGoal);
    const state = rawState.match(/^(已完成|进行中|未开始|等待|已放弃|失败|阻塞|尚未记录)(?=$|[（(\s；;。])/)?.[1] ?? rawState;
    // 任务只来自明确的任务栏目与 checkbox；正文项目符号和 Markdown 链接不是 Todo。
    const taskOutline = memoryOutline(progress).nodes;
    const tasks = taskOutline.filter(node => node.state).map(node => ({
        state: node.state, title: node.title, ...(node.abandoned ? { abandoned: true } : {}), ...(node.waiting ? { waiting: true } : {}),
    }));
    const activeTasks = tasks.filter(task => !task.abandoned);
    const estimate = field("整体进度", false, progress, compatibleGoal, canonicalGoal), match = /^(约\s*)?(\d+)%$/.exec(estimate);
    const value = match ? Number(match[2]) : null;
    const complete = state === "已完成";
    const valid = value !== null && value >= 0 && value <= 100 && value % 10 === 0 &&
        (value === 100 ? complete && !match?.[1] && activeTasks.length > 0 && activeTasks.every((t) => t.state === "已完成" && !t.waiting) : !complete);
    const current = field("当前进展", true, progress, compatibleGoal, canonicalGoal);
    const next = section("下一步与接续位置", "下一步") || field("下一步", true, progress, compatibleGoal, canonicalGoal, parseableContent);
    const progressState = valid ? "valid" : !estimate || estimate === "待评估" ? "unknown" : "conflict";
    const analysis = analyzeMemoryTasks(taskOutline);
    // Historical prose may carry a global execution boundary. Keep it conservative, but a
    // percentage-format error alone is not permission to discard explicit actionable work.
    const waiting = /(?:等待|等候|待用户|需(?:要)?用户|需要确认|待确认|待审批|待授权|暂停|停止|取消|阻塞|\b(?:blocked|waiting|paused|stopped|cancell?ed)\b)/i;
    if (state === "已放弃" || state === "失败" || waiting.test(rawState) || waiting.test(current) || waiting.test(next)) {
        analysis.actionable = [];
        analysis.complete = false;
        analysis.displayState = state === "已放弃" ? "已放弃" : state === "失败" ? "失败" : "等待";
        analysis.diagnostics = [];
    }
    else {
        analysis.actionable = analysis.actionable.filter(task => !waiting.test(task.title));
        if (state === "已完成" && !analysis.complete && tasks.some(task => !task.abandoned)) {
            analysis.actionable = [];
            analysis.displayState = "等待";
            analysis.diagnostics.push({ code: "legacy_completed_unfinished", key: "legacy-state", title: goal || "整体状态", path: [] });
        }
        if (progressState === "conflict")
            analysis.diagnostics.push({ code: "legacy_progress_conflict", key: "legacy-progress", title: "整体进度", path: [] });
        if (!analysis.actionable.length && analysis.displayState !== "已完成" && analysis.displayState !== "失败" && analysis.displayState !== "已放弃")
            analysis.displayState = tasks.length ? "等待" : "";
        // Legacy whole-state and percentage completion requirements remain conservative.
        analysis.complete &&= state === "已完成" && progressState !== "conflict";
        if (!analysis.complete && analysis.displayState === "已完成")
            analysis.displayState = tasks.length ? "等待" : "";
    }
    return { goal, state, ...(rawState !== state ? { stateDetail: rawState } : {}), current, next,
        percent: valid ? value : null, progressState, analysis,
        tasks, overLimit: [...content].length > 2000 };
}
export function memoryDocumentTitle(content) {
    const title = memoryOutline(memoryBody(content)).title;
    return title === "会话记忆" ? "" : title;
}
export function parseMemory(content) {
    const body = memoryBody(content), outline = memoryOutline(body);
    const legacy = /^##\s+(?:任务进度|任务清单|TodoList|待办事项|待办|目标与范围|目标与状态|当前目标与状态|目标与约束)\s*$/m.test(body) &&
        (!memoryDocumentTitle(content) || /^##\s+(?:任务进度|任务清单|TodoList|待办事项|待办)\s*\r?\n(?:(?!^#{1,2}\s)[\s\S])*?^整体(?:状态|进度)[：:]/m.test(body));
    if (legacy) {
        const progress = parseLegacyMemory(content);
        return { ...progress, title: memoryDocumentTitle(content), format: "legacy", outline: outline.nodes,
            complete: progress.analysis.complete };
    }
    const tasks = outline.nodes.filter(node => node.state).map(node => ({ title: node.title, state: node.state, abandoned: node.abandoned, waiting: node.waiting, depth: node.depth, line: node.line }));
    const analysis = analyzeMemoryTasks(outline.nodes), { actionable, complete, displayState: state } = analysis;
    return { goal: memoryDocumentTitle(content), title: memoryDocumentTitle(content), state, current: actionable.find(task => task.state === "进行中")?.title ?? "",
        next: actionable.find(task => task.state === "未开始")?.title ?? "", percent: null, progressState: "unknown", tasks, analysis,
        outline: outline.nodes, format: "chapters", complete, overLimit: false };
}
export function memoryComplete(progress) {
    return progress.complete ?? (progress.state === "已完成" && progress.progressState !== "conflict" && progress.tasks.some(task => !task.abandoned) && progress.tasks.filter(task => !task.abandoned).every(task => task.state === "已完成" && !task.waiting));
}
/** All task headings share the title-path protection used at write boundaries. */
export function assertMemoryTitle(previous, next) {
    assertMemoryTreeEdit(previous, next);
}
//# sourceMappingURL=memory.js.map