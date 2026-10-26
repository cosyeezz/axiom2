/**
 * WebFetch 只处理可读文本。图片 / 二进制资源既没有可摘要的正文，
 * 走 AI summary 还会白烧几十秒。分类与指引文案集中在这里，
 * 供工具 description 与运行时兜底共用同一套措辞。
 */
export type WebFetchResourceKind = 'text' | 'image' | 'binary';
export type WebFetchResourceSource = 'api' | 'local';
export declare function normalizeContentType(contentType: string | undefined): string;
export declare function classifyResourceKind(contentType: string | undefined): WebFetchResourceKind;
export declare function suggestedExtensionForContentType(contentType: string | undefined): string;
/**
 * 图片资源一旦确认，竞速必须立刻结束：远端 EdgeBrowser 对图片通常直接拒，
 * 等 20s 超时再 summary 是线上 SLA 的主要浪费。binary 不抢跑，
 * 避免把少数误标成 application/octet-stream 的 HTML 页提前掐掉。
 */
export declare function isDecisiveNonTextResourceError(error: unknown): error is NonTextResourceError;
export declare class NonTextResourceError extends Error {
    readonly kind: Exclude<WebFetchResourceKind, 'text'>;
    readonly contentType: string;
    readonly source: WebFetchResourceSource;
    constructor(kind: Exclude<WebFetchResourceKind, 'text'>, contentType: string, source: WebFetchResourceSource);
}
export declare function buildNonTextResourceGuidance(url: string, contentType: string | undefined, kind: Exclude<WebFetchResourceKind, 'text'>): string;
/** Best-effort: 释放未消费的响应体，避免把几 MB 二进制读进内存再丢掉。 */
export declare function discardResponseBody(response: Response): Promise<void>;
