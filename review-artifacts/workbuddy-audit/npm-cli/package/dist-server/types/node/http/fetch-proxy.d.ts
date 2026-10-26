import { Application, ApplicationLifecycle } from '@celljs/core';
import { Logger } from '@genie/telemetry';
/**
 * CLI 侧 fetch 代理补丁。
 *
 * 使用 ProxyResolver 按优先级链自治解析代理，
 * 失败时清除 OS 缓存并直连重试。
 */
export declare class FetchProxy implements ApplicationLifecycle<Application> {
    protected readonly logger: Logger;
    private originFetch;
    /**
     * settingsPath 显式注入，确保 WORKBUDDY_CONFIG_DIR 被尊重
     * （见 ProxyResolver class JSDoc 顶部 invariant）。
     *
     * #57186：daemon 注入 `WORKBUDDY_PAC_RPC_*` env 时自动启用 L0 PAC 反查；env
     * 缺失时退化为 L1-L4 自治链。
     */
    private proxyResolver;
    initialize(): Promise<void>;
    onStop(): Promise<void>;
}
