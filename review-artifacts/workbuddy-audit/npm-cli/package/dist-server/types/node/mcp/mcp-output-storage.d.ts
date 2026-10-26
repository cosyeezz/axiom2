import { CallToolResultContent } from './mcp-protocol';
/**
 * 计算内容的字符数（与原 checkTokenUsage 同 metric，image 块跳过）。
 *
 * 对非法块（字段缺失 / 类型错误）容错：按 0 处理而不是抛错，保证
 * processMcpResult 的"永不 throw"契约不会被上游返回的异常结构打破。
 */
export declare function computeCharCount(content: CallToolResultContent): number;
/**
 * 检测内容是否含 image 块。含 image 时走截断而非落盘：base64 图片 payload
 * 写入 `.txt` 文件会丢失 UI 层的图片查看/渲染集成。cbc 不像 CC 那样会
 * `compressImageBlock` 压缩图片塞进剩余预算——预算够则原样保留，不够则丢。
 */
export declare function contentContainsImages(content: CallToolResultContent): boolean;
/**
 * 生成模型指引文本（逐字对齐 CC `getLargeOutputInstructions`）。
 */
export declare function getLargeOutputInstructions(rawOutputPath: string, contentLength: number, formatDescription: string): string;
/** 截断降级文案（对齐 CC `getTruncationMessage` + `truncateMcpContent`）。 */
export declare function getTruncationMessage(maxTokens: number): string;
/**
 * 截断内容到 maxTokens*4 字符上限。
 *   - text: 切片到剩余预算
 *   - image: 整块保留（不计入预算；cbc 无压缩）
 *   - resource / resource_link / audio: 预算有剩整块保留，否则丢弃但
 *     **插入占位文本**告知模型"N 个 X 类型块因超限被丢弃"——不让降级悄无声息地丢数据
 */
export declare function truncateMcpContent(content: CallToolResultContent, maxTokens: number): CallToolResultContent;
/** 落盘结果 union。 */
export type PersistResult = {
    filepath: string;
    originalSize: number;
} | {
    error: string;
};
/**
 * 把内容写入会话的 tool-results 目录。
 * 路径规则与 `ToolResultBlobService` 一致：
 *   - 主 session: `~/.codebuddy/projects/<hash>/<sessionStoreId>/tool-results/mcp-<server>-<tool>-<ts>-<rand>.txt`
 *   - 子 agent:  `~/.codebuddy/projects/<hash>/<parentSessionId>/subagents/<storeId>/tool-results/...`
 *
 * 文件名含 6 位随机后缀，避免同毫秒并发 call 互相覆盖。
 */
export declare function persistMcpOutput(content: CallToolResultContent, sessionStoreId: string, parentSessionId: string | undefined, serverName: string, toolName: string): Promise<PersistResult>;
/**
 * 统一入口：返回替换后的 content，**永不 throw**。
 *
 * 决策逻辑：
 *   1. 未超限 → 原样返回
 *   2. env 禁用 / 含 image / 无 sessionStoreId / 落盘失败 → 截断降级
 *   3. 否则 → 落盘，返回单条 text 指引
 *
 * 最外层 try/catch 兜底任何意外 throw（如 DI container 未就绪时
 * `PathUtils.getHomeProjectDir` 抛、content 结构异常让 helper 抛等），
 * 失败时用同步的最小截断确保模型拿到可读内容。
 */
export declare function processMcpResult(content: CallToolResultContent, maxTokens: number, serverName: string, toolName: string, sessionStoreId: string | undefined, parentSessionId: string | undefined): Promise<CallToolResultContent>;
