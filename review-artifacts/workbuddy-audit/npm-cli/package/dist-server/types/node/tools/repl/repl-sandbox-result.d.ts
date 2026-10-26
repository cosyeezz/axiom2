/**
 * Unwrap human-formatted tool `content` into a value the REPL sandbox can use
 * as data. Direct LLM tool results stay as display text; only this boundary
 * (broker.callTool → worker) should reshape them.
 *
 * The live failure this exists for: models write `const r = await Bash(...)`
 * then read `r.stdout`, get undefined, and burn turns writing a regex parser
 * for `Command:` / `Stdout:` / `Stderr:` blocks (and for Read's `   1→` prefix).
 */
import type { BridgeImage } from './repl-protocol';
export interface SandboxShellResult {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    signal: string | null;
}
/** 骨架目录里写在 `Name(params)` 后面的返回值，不被 SUMMARY_MAX_CHARS 截断。 */
export declare function sandboxReturnAnnotation(toolName: string): string | undefined;
export declare function toSandboxToolResult(toolName: string, toolResult: {
    content?: unknown;
    rawResponse?: unknown;
    renderer?: {
        type?: string;
        value?: unknown;
    };
}): unknown;
/**
 * Broker → worker 的回包。TaskOutput 在「任务不存在」时仍带 `error`，
 * 但不能因此丢掉 `status`：worker 对非 Agent 错误原样 `{ error }`，
 * 模型会写 `r.status || "done"` 把 unknown 当成完成。
 */
export declare function sandboxToolCallReply(toolName: string, toolResult: {
    content?: unknown;
    error?: string;
    rawResponse?: unknown;
    renderer?: {
        type?: string;
        value?: unknown;
    };
}): {
    result?: unknown;
    error?: string;
};
/** Read 图的 content：`[{ type:"image_url", image_url:{ url:"data:image/..." } }]`。 */
export declare function parseImageToolContent(content: string): unknown | undefined;
export declare function splitCellImages(value: unknown): {
    result: unknown;
    images: BridgeImage[];
};
/**
 * 人读的执行详情文本，供工具结果行的 renderer 展示（可折叠、ctrl+o 展开）。
 *
 * 与 {@link buildReplToolContent} 分工明确：后者产出**模型面**的结构化 JSON
 * （`{ result, stdout, stderr }`，供沙箱/模型索引），这里产出**人面**的纯文本。
 * 优先级：error > 返回值 > stdout，末尾附 stderr。图片一律脱敏/剔除（base64 不进
 * 展示文本，图片走 content 数组的 image_url 单独渲染）。无任何输出时返回空串，
 * 由调用方决定占位（如只显示耗时）。
 */
export declare function buildReplDisplayText(out: {
    result?: unknown;
    resultTruncated?: boolean;
    stdout: string;
    stderr: string;
    error?: string;
}): string;
/**
 * 把 REPL 返回值压成文本，供模型面截断判定与落盘复用。
 *
 * - string 原样返回；
 * - 其余（多为结构化 JSON）压成**紧凑**序列化文本——模型面要控制 token，
 *   与 `buildReplDisplayText` 的 pretty JSON（人面）刻意不同。
 * - JSON.stringify 失败（如 cyclic）时退化为 String(result)。
 *
 * 截断只发生在主线程的模型面组装（buildReplToolContent）；沙箱内模型代码拿到的
 * 仍是完整返回值，人面展示也走完整 result，互不影响。
 */
export declare function replResultToText(result: unknown): string;
/**
 * REPL 出参。有图则走 read-tool 同款 image_url 数组，避免把 base64 再塞进 result 文本。
 */
export declare function buildReplToolContent(out: {
    result?: unknown;
    resultTruncated?: boolean;
    stdout: string;
    stderr: string;
    error?: string;
    images: BridgeImage[];
}): string;
export declare function parseShellFormatted(content: string, rawResponse?: unknown): SandboxShellResult | undefined;
export declare function stripReadLineNumbers(content: string): string;
export interface SandboxAgentSpawnResult {
    taskId: string;
    id: string;
    name?: string;
    agentId?: string;
}
/** Background Agent() returns labeled text to the LLM; sandbox wants `r.taskId`. */
export declare function parseAgentSpawn(content: string): SandboxAgentSpawnResult | undefined;
/**
 * 同步 Agent() 的回复末尾带 `[Agent ID: <id>]`（agent-task 的 trailer，供 LLM 侧 resume / 审计解析）。
 * 沙箱里模型把它当数据用：子代理回 JSON 时 `JSON.parse(subText)` 会在 JSON 结尾报
 * "Unexpected non-whitespace character after JSON"，模型要多绕几轮 REPL 甚至重派子代理。
 * 只在沙箱边界剥掉；直接返回给 LLM 的工具结果保持原样。
 */
export declare function stripAgentIdTrailer(content: string): string;
export interface SandboxTaskOutputResult {
    status: string;
    taskId?: string;
    content: string;
    result?: unknown;
    error?: string;
}
/**
 * TaskOutput 对人读是 `Status: running` 文本；沙箱要的是 `r.status`。
 * 缺这个字段时模型会写 `r.status || "done"`，把还在跑的 teammate 当成完成。
 */
export declare function parseTaskOutput(content: string, renderer?: {
    type?: string;
    value?: unknown;
}): SandboxTaskOutputResult;
