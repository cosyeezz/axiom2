/**
 * Chat HTTP 伽利略指标。口径与 daemon `net-galileo-metrics.ts` 对齐：
 *   wb.api.request + outcome / net_class → 成功率、P95、弱网成功率。
 *   host → 主备 origin 流量占比（请求量口径）；error_code → 传输层 errno 细分。
 *   path → 接口路径统计（pathname 去掉 query，动态段归一化为 :id）。
 *   pin → 地址层钉住的 IP（含 Anycast 兜底），未钉为 none；用于 Anycast IP 成功率统计。
 *   source 按路径区分 Chat / Image / Video，其余为 Other。
 *   只有聊天补全的 host 和 pin 会按 conversation request id 记住，供 error_detail 绑定。
 *
 * agent-cli 不依赖 workbuddy-server，此处保持同名常量和分类规则。
 */
export declare const WB_API_REQUEST_METRIC = "wb.api.request";
export declare const WEAK_NET_DURATION_MS = 2000;
export declare const CHAT_API_METRIC_STARTED_AT = "__wbApiMetricStartedAt";
/**
 * 记住本轮 `wb.api.request` 实际上报的域名和钉住的 IP。
 * 后写入的覆盖先写入的：切备站、再钉 IP 后，错误码读到的是最后一跳。
 */
export declare function rememberChatApiHost(conversationRequestId: string | undefined, host: string | undefined, pin?: string): void;
/** 备站失败后选定钉 IP 时立刻记下，后面的直连样本和 error_detail 都读它。 */
export declare function noteChatApiPin(conversationRequestId: string | undefined, pin: string | undefined): void;
/** 本轮没有对应 API 样本时返回空串，避免把无关请求的域名套到错误码上。 */
export declare function readChatApiHost(conversationRequestId: string | undefined): string;
/** 最后一跳钉住的 IP。未钉或没有样本时为空串。 */
export declare function readChatApiPin(conversationRequestId: string | undefined): string;
export declare function resetChatApiHostForTests(): void;
interface DurationReporter {
    recordDuration(metric: string, durationMs: number, dimensions?: Record<string, string>): void;
}
/**
 * 从目标 URL 提取 hostname 作为 `host` 维度（与 daemon `classifyHostFromUrl` 对齐）。
 * 只取 host，不带 path / query：低基数且不携带敏感参数；无法解析时归为 `unknown`。
 */
export declare function classifyHostFromUrl(url: string | undefined): string;
/**
 * 从目标 URL 提取 pathname 作为 `path` 维度（与 daemon `classifyPathFromUrl` 对齐）。
 * 动态段（纯数字 id / UUID / 8 位以上 hex）归一化为 `:id`，不含 query / hash。
 */
export declare function classifyPathFromUrl(url: string | undefined): string;
/**
 * 失败样本的传输层错误码维度：ETIMEDOUT / ECONNRESET / …，无错误为 `none`。
 */
export declare function classifyErrorCode(error: unknown): string;
/**
 * 地址层钉住的 IP 作为 `pin` 维度（与 daemon `classifyPin` 对齐）。
 * 钉 IP 只改 lookup 不改写 URL，host 维度仍是逻辑域名——区分「域名解析」与
 * 「钉 IP（含 Anycast 兜底 162.14.3.241）」只能靠该维度；未钉时为 `none`。
 */
export declare function classifyPin(ip: string | undefined): string;
/**
 * `wb.api.request` 的 source。聊天补全、图片、视频分开，避免工具请求被记成 Chat。
 * 认不出的路径用 Other，不再默认当成聊天。
 */
export declare function classifyWbApiSource(url: string | undefined): string;
export declare function reportChatApiRequestToGalileo(reporter: DurationReporter | undefined, input: {
    method?: string;
    status?: number;
    startedAt?: number;
    error?: unknown;
    /** 最终目标 URL（含 failover 后实际选中的 origin），用于提取 host 维度；缺省归 unknown */
    url?: string;
    /** 地址层本次钉住的 IP（含 Anycast 兜底），未钉为 undefined；用于 pin 维度 */
    pin?: string;
    /** 有 url 时，把本次上报的 host 记到该请求上，供 error_detail 读取 */
    conversationRequestId?: string;
}): void;
export {};
