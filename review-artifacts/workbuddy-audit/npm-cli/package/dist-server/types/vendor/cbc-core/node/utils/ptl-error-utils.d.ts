/**
 * PTL (Prompt Too Long) 错误解析工具。
 *
 * 当 model 返回 400 input-length-too-long 类错误时，从错误文本中解析 actual/limit token 数值，
 * 计算 gap = actual - limit。拦截器用 gap 决定需要丢弃多少历史 token 才能让下一次请求通过。
 *
 * 覆盖的错误格式（按 provider）：
 *   1. Anthropic / Vertex  : "prompt is too long: 137500 tokens > 135000 maximum"
 *   2. 通用 / 内部网关       : "input length too long: ... 150000 tokens ... 128000 maximum ..."
 *   3. OpenAI              : "This model's maximum context length is 128000 tokens. However, your messages resulted in 150000 tokens"
 *   4. Gemini-style        : "Input length: 150000 exceeds maximum: 128000"
 *
 * 解析失败时返回 { actualTokens: undefined, limitTokens: undefined, gap: undefined }，
 * 调用方应 fallback 到按 groups.length * 0.2 截断。
 */
export declare namespace PtlErrorUtils {
    /**
     * 解析错误文本中的 actual / limit token 数值。
     *
     * @returns 解析成功返回具体数值，失败返回 { actualTokens: undefined, limitTokens: undefined, gap: undefined }
     */
    function parsePromptTooLongTokenCounts(error: unknown): {
        actualTokens?: number;
        limitTokens?: number;
        gap?: number;
    };
}
//# sourceMappingURL=ptl-error-utils.d.ts.map