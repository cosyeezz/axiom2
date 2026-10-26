/**
 * Chat 容灾分两层：HTTP 故障先切备站、备站仍失败再换 IP；
 * 入口 LocalDNS 失败升 HTTP-DNS；HTTP-DNS 也空才切备站。
 *
 * 第一跳始终走当前 origin 的域名（代理可拦截、由代理解析）。
 * 主站失败后改打备站域名；备站再失败才从 HTTPDNS / 兜底 IP 钉直连。
 * 切备站 / 换 IP 覆盖客户端传输失败（连接、解析、TLS、证书、无路由），
 * 以及网关 502/503/504。必须发生在首个 2xx 响应（流已提交）之前。
 * 代理路径同样走容灾，不因 HTTP_PROXY / 系统代理跳过。
 */
import { type Readable } from 'node:stream';
import { type ProductConfiguration } from '@genie/product';
import { type AddressPinSource } from '@genie/product/lib/node/network-address';
export declare const CHAT_ADDRESS_SLOT_KEY = "__workbuddyChatAddress";
export declare const CHAT_ORIGIN_REPLAY_KEY = "__workbuddyChatOriginReplay";
export declare const CHAT_STREAM_COMMITTED_KEY = "__workbuddyChatStreamCommitted";
export declare const CHAT_FAILOVER_INFLIGHT_CODE = "ERR_WB_CHAT_FAILOVER_INFLIGHT";
export interface ChatAddressSlot {
    targetUrl: string;
    hostname: string;
    candidates: string[];
    index: number;
    local: string[];
    httpdns: string[];
    fallback: string[];
    pinSource: AddressPinSource;
}
/**
 * axios 拦截器请求配置 + Chat 容灾 / 代理自愈字段。
 * 不继承 InternalAxiosRequestConfig：agent-cli 与 @celljs/http 的 Axios 类型不一致
 *（headers 是否必填、Method 是否含 QUERY），绑任何一边都会把另一边打爆。
 */
export interface ChatAddressConfig {
    url?: string;
    baseURL?: string;
    method?: string;
    headers?: unknown;
    httpAgent?: unknown;
    httpsAgent?: unknown;
    signal?: AbortSignal;
    [CHAT_ADDRESS_SLOT_KEY]?: ChatAddressSlot;
    [CHAT_ORIGIN_REPLAY_KEY]?: boolean;
    [CHAT_STREAM_COMMITTED_KEY]?: boolean;
    __proxySource?: string;
    __proxyRetried?: boolean;
    __proxyForceDirect?: boolean;
}
export interface ObserveReadableStreamOptions {
    signal?: AbortSignal;
    timeoutMs?: number;
}
/**
 * 空包探测上限：0 表示只等一个 setImmediate。
 * 立刻 end 的 Whistle 空包会在这个窗口内被识别；headers 后一直不出字则放行，
 * 让 ModelProvider 的首 token 计时生效，而不是把 Axios 拦截器挂死。
 */
export declare const CHAT_EMPTY_STREAM_PROBE_MS = 0;
export declare function isProductChatCompletionsUrl(method: string | undefined, url: string): boolean;
export declare function currentChatAddress(slot: ChatAddressSlot | undefined): string | undefined;
export declare function hasRemainingChatAddress(slot: ChatAddressSlot | undefined): boolean;
export declare function isChatStreamingBody(data: unknown): boolean;
export declare function markChatStreamCommitted(config: ChatAddressConfig | undefined): void;
export declare function isChatStreamCommitted(config: ChatAddressConfig | undefined): boolean;
export declare function isChatFailoverInflightError(error: unknown): boolean;
export declare function isChatAddressRetryable(error: unknown): boolean;
export declare function isChatOriginReplayable(error: unknown): boolean;
export declare function readChatReplayInflightKey(config: {
    headers?: unknown;
} | undefined): string | undefined;
export declare function hasInFlightChatOriginReplay(key: string | undefined): boolean;
export declare function beginChatOriginReplay(key: string | undefined): boolean;
export declare function endChatOriginReplay(key: string | undefined): void;
export declare function createChatFailoverInflightError(): Error;
export declare function resetChatOriginReplayInflightForTests(): void;
/**
 * Whistle / 网关 200 空包：还没出字，可以切备站。
 * 流式 200 的 headers 到达时 data 常是 undefined / Stream，不能当成空包。
 */
export declare function isNodeReadableStream(data: unknown): data is Readable;
/**
 * Completions 走 responseType=stream。Whistle 空包是立刻 end 的 Readable，
 * 不能按普通 `{}` / `''` 判断，否则会当成功流回传、会话层再打十几次主站。
 *
 * 探测不能无界等待首字节：ModelProvider 的首 token 计时要拿到 Axios 响应后才安装。
 * 因此只等 abort / close / end / 首字节 / 有界超时；超时视为“非空”，把流转发出去。
 * 首字节前的 source error 直接 reject；首字节后用 pipeline 转发 error/close。
 */
export declare function observeReadableStreamEmptiness(data: unknown, options?: ObserveReadableStreamOptions): Promise<{
    empty: boolean;
    data: unknown;
}>;
export declare function isChatEmptySuccessBody(data: unknown): boolean;
export declare function selectChatBackupOrigin(targetUrl: string, product?: ProductConfiguration): string | undefined;
export declare function applyChatSelectedOrigin(config: {
    url?: string;
    baseURL?: string;
}, targetUrl: string, selectedOrigin: string): string;
export declare function logChatOriginReplay(fromUrl: string, toUrl: string, error?: unknown): void;
export declare function advanceChatAddress(slot: ChatAddressSlot): string | undefined;
export declare function recordChatAddressOutcome(slot: ChatAddressSlot | undefined, success: boolean): void;
export declare function prepareChatAddressSlot(input: {
    targetUrl: string;
    product: ProductConfiguration | undefined;
    requestIsDirect: boolean;
    existing?: ChatAddressSlot;
}): Promise<ChatAddressSlot | undefined>;
export declare function applyChatAddressPin(config: ChatAddressConfig, targetUrl: string, slot: ChatAddressSlot): void;
export declare function logChatAddressAttempt(slot: ChatAddressSlot | undefined, error?: unknown, status?: number): void;
