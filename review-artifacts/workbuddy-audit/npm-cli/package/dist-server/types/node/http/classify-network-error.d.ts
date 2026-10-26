/**
 * CLI 侧网络失败原因分类器。
 *
 * 与 daemon 侧 `@genie/workbuddy-server` 的 `net/classify-network-error.ts` 保持
 * 同一套判定口径（代理 / PAC / CA / DNS / 超时 / 重置 / 拒绝），但因 agent-cli 是
 * 独立发布、不依赖 workbuddy-server，这里单独维护一份纯函数实现。改动分类规则时
 * 两处需同步。
 *
 * 目的：让 CLI 的网络失败日志能一眼区分「代理连不上 / PAC 出问题 / CA 证书校验
 * 失败」，而不是笼统一句 `fetch failed`。
 */
export type CliNetworkErrorCategory = 'ca' | 'pac' | 'proxy' | 'dns' | 'timeout' | 'reset' | 'refused' | 'unknown';
export interface CliNetworkErrorClassification {
    category: CliNetworkErrorCategory;
    code?: string;
    detail: string;
    chain: string;
}
export declare function classifyCliNetworkError(error: unknown): CliNetworkErrorClassification;
/** 产出一行可直接落日志的 CLI 网络错误分类字符串。 */
export declare function formatCliNetworkErrorForLog(error: unknown): string;
