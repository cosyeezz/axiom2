/**
 * REPL 内部工具调用的展示记录。
 *
 * worker-manager 在每次内层 `toolCall` 前后调用 {@link ReplToolCallRecorder}，记录
 * name / 参数 / 状态 / 耗时；快照随 `CellResult.toolCalls` 回到 REPL 工具层，TUI
 * 每次调用只渲染一行。
 *
 * 字段有独立预算（见 REPL_TOOL_CALL_DISPLAY_LIMITS）：内部调用只服务展示，
 * 不能把 session jsonl 或模型上下文撑大。
 */
import type { ReplToolCallDisplay, ReplToolCallsDisplay } from '../tool-protocol';
interface PendingReplToolCall {
    record: ReplToolCallDisplay;
    startedAt: number;
}
/** 一次 cell 的内部调用记录器（非线程安全，per-run 使用）。 */
export declare class ReplToolCallRecorder {
    private readonly calls;
    private argumentBytes;
    private sequence;
    private omitted;
    /**
     * 记录一次调用开始。条数超限时只累加 `omitted`，返回 undefined；
     * 调用方仍正常执行工具，只是不再展示。
     */
    begin(callId: string, name: string, params: unknown): PendingReplToolCall | undefined;
    /** 记录调用结束；错误文案截断后随行展示。 */
    finish(pending: PendingReplToolCall | undefined, error?: string): void;
    /** 无调用时返回 undefined，保持旧会话/空 cell 的渲染路径不变。 */
    snapshot(): ReplToolCallsDisplay | undefined;
}
export {};
