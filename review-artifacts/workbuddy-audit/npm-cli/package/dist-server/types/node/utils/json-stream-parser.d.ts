/**
 * JsonStreamParser - 流式 JSON 解析器
 *
 * 用于在 tool_call_update 消息流中累积 JSON 片段并尝试提前解析出完整的参数。
 *
 * 核心功能：
 * 1. 累积流式 JSON 片段
 * 2. 在 JSON 不完整时智能补全括号和引号后解析
 * 3. 对无法补全的情况逐个提取已完成的键值对
 *
 * 移植自 packages/agent-ui/src/adapters/utils/json-stream-parser.ts；
 * 同步修复时请一并改动上游，避免分叉。
 *
 * 异常策略：本类区分两类错误：
 * - SyntaxError — 预期的"JSON 尚未闭合"，静默继续累积
 * - 其他异常（TypeError 等）— 意味着传入数据破坏了解析器前提，通过可选的
 *   onUnexpectedError 回调向调用方暴露；不再静默吞掉（对齐项目规范
 *   FEEDBACK_ERROR_LOG_PRESERVE_STACK）
 */
export interface JsonParseResult {
    /** 是否解析成功（完整 JSON） */
    complete: boolean;
    /** 解析出的参数（部分或完整） */
    parameters: Record<string, unknown>;
    /** 原始缓冲区内容 */
    rawBuffer: string;
}
export type UnexpectedErrorHandler = (err: unknown, context: string) => void;
export declare class JsonStreamParser {
    private buffer;
    private parsedParams;
    private completed;
    private onUnexpectedError?;
    constructor(onUnexpectedError?: UnexpectedErrorHandler);
    private reportUnexpected;
    appendDelta(delta: string): JsonParseResult;
    setComplete(json: Record<string, unknown> | string): void;
    getCurrentResult(): JsonParseResult;
    getBuffer(): string;
    isCompleted(): boolean;
    private tryParse;
    private trySmartParse;
    private tryFixMissingPrefix;
    private tryCompleteJson;
    private extractPartialKeyValues;
    private tryParseValue;
    private smartSplitJson;
    private unescapeJsonString;
    private updateParsedParams;
    private getParametersObject;
}
