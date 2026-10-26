/**
 * 按 SSE 行累计流出的思考文本，供 reasoning-only 空流把它随 EmptyStreamError 交给会话层续写。
 *
 * 不复用 `parseSSEChunk`：它按单个原始分片切行，跨分片被劈开的 data 行解析失败会静默丢字。
 * 这里跨分片保留半行与未解码完的 UTF-8 字节，取值口径与 `@openai/agents-openai` 补丁一致：
 * 只看首个 choice，同一 delta 优先 `reasoning_content`，缺省才用 `reasoning`。
 */
export declare class StreamedReasoningCollector {
    private readonly decoder;
    private pendingLine;
    private collected;
    push(chunk: Uint8Array): void;
    /** 流已判定结束时收尾：末行可能没有换行符，完整的就计入，残缺的解析失败自然忽略。 */
    finish(): string;
    private consumeLine;
}
