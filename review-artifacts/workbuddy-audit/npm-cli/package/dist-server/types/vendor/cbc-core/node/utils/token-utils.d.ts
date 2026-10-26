/**
 * Token 计算工具类
 * 用于估算文本内容的 token 数量
 */
export declare class TokenUtils {
    /**
     * 粗略估算 token 数量
     * 规则:
     * - 英文约 4 字符 = 1 token
     * - 中文约 1.5-2 字符 = 1 token (取 1.8)
     * - 空格和标点单独计算
     *
     * @param text 需要计算 token 的文本内容
     * @returns 估算的 token 数量
     */
    static estimateTokensRough(text: string): number;
    /**
     * 从 history item 中移除图片内容，返回轻量副本用于 token 估算。
     * 不修改原始对象。
     *
     * 处理的图片格式：
     * - content 数组中 type 为 image_url / image / input_image / image_blob_ref 的块 → 替换为占位符
     * - 任意字符串字段中以 data:image/ 开头的 base64 数据 URI → 替换为 [image_omitted]
     * - 任意字符串字段本身是序列化的 JSON（数组/对象），且其中嵌套了图片数据 → 解析、剥离、重新序列化
     *   （ACP function_call_result 的 output.text / providerData.toolResult.content 就是这种形态）
     */
    static createItemWithoutImages(item: any): any;
    /**
     * 等价于 `JSON.stringify(createItemWithoutImages(item))`，但**不构造整份对象副本**。
     *
     * 原实现为了剥图片估 token，会先 `JSON.parse(JSON.stringify(item))` 深拷一份完整
     * history item，再就地剥图片、再 `JSON.stringify`。长会话每轮对整份 history 逐条走这条
     * 路径时，深拷产生的临时对象是 OOM 的主要来源（见 issue #82125）。
     *
     * 这里改为**只读遍历**原对象，直接产出与"剥图片后再序列化"完全一致的 JSON 字符串，
     * 全程不 clone、不 mutate 原对象。产出字符串与旧实现 byte-for-byte 一致，
     * 因此 estimateTokensRough 结果不变、compact 触发判断不受影响。
     *
     * 若遍历中途抛错（极端不可序列化对象），回退到 String(item) 与旧实现兜底行为对齐。
     */
    static stringifyWithoutImages(item: any): string;
    /**
     * 只读序列化：产出与 `JSON.stringify` 相同的字符串，但把图片内容替换为占位符。
     * 返回 undefined 表示该值在 JSON 中会被省略（对齐 JSON.stringify 对 undefined/function 的处理）。
     */
    private static _serializeStripped;
    /** 只读处理字符串字段，产出与 `_stripImagesFromString` 剥离后再 JSON.stringify 一致的结果。 */
    private static _serializeStrippedString;
    private static readonly _IMAGE_CONTENT_TYPES;
    /** 递归移除对象中的图片内容（就地修改） */
    private static _stripImages;
    /**
     * 处理字符串字段中的图片数据：
     * 1. data:image/ 开头的整段 → 替换为占位符
     * 2. 看起来像 JSON 数组/对象的字符串 → try-parse → 递归剥离 → 重新 stringify
     *    用于处理 ACP function_call_result 里 output.text / toolResult.content 这类
     *    嵌套 JSON 字符串（image_blob_ref / image_url 都藏在这里）
     */
    private static _stripImagesFromString;
    /**
     * 估算 history 尾部连续的 function_call_result 消息的 token 数。
     *
     * API 返回的 inputTokens 是模型处理请求时的实际 token 数，但不包含该轮
     * tool call 执行后产生的 function_call_result（这些结果在 API 返回后才追加到 history）。
     * 为了更准确地判断是否需要触发压缩，需要把这部分 token 补上。
     *
     * 从 history 末尾往前扫描，只收集紧挨在末尾的连续 function_call_result。
     * 一遇到非 function_call_result（含 function_call）即停止：function_call 属于上一轮
     * 已经进过请求的内容，穿过它会把更早轮次的 result 重复计入 inputTokens（#133055）。
     * 注意：估算前会移除图片内容，避免 base64 图片数据导致 token 严重偏高。
     */
    static estimateTrailingToolResultTokens(history: any[]): number;
}
//# sourceMappingURL=token-utils.d.ts.map