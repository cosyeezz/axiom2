/**
 * 按需下载链接的落地前校验（fail-closed）：目录接口化后连接器包由接口下发签名链接，
 * 落地是「下载 zip → 解压 → 注册成可执行 MCP 包」，链接被污染即任意写盘 + 内网探测。
 * sha256 与 URL 同源，不能承担来源可信性，来源必须在写盘前单点收口。
 *
 * - 只接受 https；字面主机与解析结果（dns.lookup all）任一落在环回 / 未指定 / 私网 /
 *   链路本地即拒绝。
 * - 直连：已校验地址全部钉给 undici（IPv4 在前），消除「校验时公网、连接时内网」的
 *   DNS 竞态。**代理（PAC / env）下不做钉扎**：CONNECT 后目标由代理解析，客户端无法
 *   绑定实际连接地址（curl --resolve 同款限制）；该路径的剩余防线是 https 端到端
 *   TLS 证书校验——可被分域解析用于内网端口探测（盲 SSRF），不能读取响应内容。
 *
 * 使用约定：真实 HTTP 取包统一走 `fetchSafeDownload`（`redirect: 'manual'` 逐跳校验），
 * 禁止 `redirect: 'follow'` 事后校验 `response.url`——那时间点每一跳都已发出。
 */
interface AddressRecord {
    address: string;
    family: number;
}
type AddressLookup = (hostname: string) => Promise<readonly AddressRecord[]>;
/** 单测注入解析结果；缺省走系统 `dns.lookup`。 */
export declare function setSafeDownloadAddressLookupForTests(lookup?: AddressLookup): void;
/**
 * fail-closed 逐跳下载：`redirect: 'manual'`，对每一跳（首跳 + 所有重定向落点）在发起
 * 下一次请求前校验；落在禁止范围直接抛错，既不请求也不消费响应。
 */
export declare function fetchSafeDownload(rawUrl: string, name: string, init?: {
    signal?: AbortSignal;
    resolveProxyForUrl?: (url: string) => Promise<string | undefined>;
}): Promise<Response>;
/** 校验失败即抛错（调用方按普通下载失败处理，不落盘）。 */
export declare function assertSafeDownloadUrl(rawUrl: string, name: string): void;
/**
 * 环回 / 内网 / 链路本地地址判定（IPv4 + IPv6 + 内网域名后缀）；域名的解析结果由
 * `resolvePinnedAddresses` 复用同一判定。
 */
export declare function isPrivateNetworkHostname(hostname: string): boolean;
export {};
//# sourceMappingURL=safe-download.d.ts.map