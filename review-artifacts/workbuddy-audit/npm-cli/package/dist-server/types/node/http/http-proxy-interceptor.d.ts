import { Application, ApplicationLifecycle, Logger } from '@celljs/core';
import { RestOperations } from '@celljs/http';
import { ProductManager } from '@genie/product';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { ConsoleManager } from '../console';
import { GalileoService } from '../galileo/galileo-protocol';
import { CertificateManager } from './certificate-manager';
import { HttpProxyProvider } from './http-proxy-protocol';
/**
 * CLI 侧 HTTP 代理拦截器。
 *
 * 使用 ProxyResolver 按优先级链自治解析代理（配置文件 > env > OS > 直连），
 * 不再依赖主进程 spawn 时注入的静态环境变量。
 *
 * 失败自愈：检测到代理相关错误时清除 OS 缓存重新解析，用新代理重试一次。
 */
export declare class HttpProxyInterceptor implements ApplicationLifecycle<Application> {
    protected readonly hostProxy?: HttpProxyProvider;
    protected readonly productManager: ProductManager;
    protected readonly restOperations: RestOperations;
    protected readonly certificateManager: CertificateManager;
    protected readonly consoleManager: ConsoleManager;
    protected logger: Logger;
    protected readonly galileo?: GalileoService;
    /** 代理 Agent 缓存，按 proxyUrl + version 做 key */
    agentCache: Map<string, {
        http?: HttpProxyAgent<string>;
        https?: HttpsProxyAgent<string>;
    }>;
    private loggedInvalidProtocol;
    /**
     * 自治式代理解析器。settingsPath 显式注入，确保 WORKBUDDY_CONFIG_DIR 被尊重，
     * 不依赖 ProxyResolver 内部默认值（见 ProxyResolver class JSDoc 顶部 invariant）。
     *
     * #57186：当 daemon 注入 `WORKBUDDY_PAC_RPC_*` env 时（WorkBuddy Desktop 路径），
     * 自动启用 L0 PAC 反查 hook，per-request 走 daemon→main 的 Chromium PAC 引擎，
     * 完整识别企业 PAC 脚本的 per-URL 决策。env 缺失（独立 cbc CLI / 单测 / headless）
     * 时 hook 为 undefined，行为退化为 L1-L4 自治链，向后完全兼容。
     */
    private proxyResolver;
    /**
     * keep-alive 参数，对抗中间 LB/NAT 的 TCP idle timeout。
     * 背景：2026-04-25 偶发 502 socket hang up。
     */
    private static readonly KEEP_ALIVE_OPTS;
    private defaultHttpsAgent?;
    /**
     * configuration 变更订阅句柄。当前拦截器为单例、生命周期与进程一致，泄漏风险低；
     * 显式持有以便 onStop 注销，避免后续若改为按会话/按窗口实例化时订阅泄漏、
     * 在旧实例上重复 disableTlsVerification 打日志（评审 #69542）。
     */
    private tlsConfigSub?;
    private getDefaultHttpsAgent;
    private getCABundle;
    private getSSLOptions;
    /**
     * 命中 DisableTlsVerification 时幂等地设置 NODE_TLS_REJECT_UNAUTHORIZED='0'。
     * 加 env 守卫，避免在每次 configuration 变更时重复设置与重复打日志。
     */
    private applyTlsVerificationFromConfig;
    /** 进程停止时注销 configuration 订阅，释放 applyTlsVerificationFromConfig 闭包（评审 #69542）。 */
    onStop(): void;
    private applyConfigFallbackAddress;
    initialize(): Promise<void>;
    private finishChatSuccess;
    private attachChatAddressLayer;
    private replayChatAddress;
    private continueChatAddressReplay;
    /**
     * 网关在错误体里下发 `retry_policy.retry === false` 时，备站与钉 IP 重放都不再发起。
     *
     * 只对会触发重放的 HTTP 状态（408/502/503/504）读错误体，其余错误不引入额外等待。
     * 读取结果按响应缓存，模型层请求级判定复用同一份，流只消费一次。读取期间请求被取消时
     * 同样不重放；读不到（超时 / 超限 / 流出错）按无策略处理，照常重放。
     */
    private isChatReplayBlockedByRetryPolicy;
    /** 钉 IP 直连不能再被请求拦截器挂回代理，并把 IP 留给后续上报。 */
    private notePinnedChatAttempt;
    /**
     * 聊天、图片、视频都上报 wb.api.request，source 按路径区分。
     * 钉住的 IP 只回落到聊天补全；工具请求不借用聊天那一跳的 pin，也不改写聊天域名记忆。
     */
    private reportObservedChatApi;
    private resolveChatTargetUrl;
    /**
     * 读取本次请求地址层钉住的 IP，供 wb.api.request 的 pin 维度使用。
     * Chat 钉 IP 状态在 CHAT_ADDRESS_SLOT_KEY 上（candidates[index]）；
     * config.fetch 的最终兜底钉 IP 直接记录在 CONFIG_FETCH_FALLBACK_ADDRESS_KEY。
     * 两者都没有时返回 undefined（维度归 none，即域名/代理解析路径）。
     */
    private readChatPinnedAddress;
    private replayChatOrigin;
    /** RestOperations 与 ChatAddressConfig 分属两套 Axios 类型，只在发送边界收窄一次。 */
    private restRequest;
    /**
     * TLS 叶证书失败：从 OS 证书库同步一次。
     * 手动 Whistle/Charles 走 source=config/env，不能走关校验的 system 分支。
     * 指纹变了则清 agent 后重试当前请求；未变或 dump 失败则返回 undefined，交给后续逻辑。
     */
    private retryAfterOsCaRefresh;
    /** TLS 证书验证失败（代理可达但 CA 不受信） */
    private isTlsCertError;
    /**
     * CA 刷新自愈路径专用的 TLS 错误判定：{@link isTlsCertError} 的超集。
     *
     * 额外覆盖 `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`——MITM 代理根不在本地信任库时
     * OpenSSL 的典型报错（链上找不到受信签发者）。#127262 场景（装根/换根后发
     * 消息失败）若命中此码，此前因不在 isTlsCertError 清单内而永不触发 OS CA
     * 刷新，自愈链路整体失效，只能重启进程。
     *
     * 只用于无安全副作用的 CA 刷新重试（{@link retryAfterOsCaRefresh}）；
     * `disableTlsVerification` 等关校验降级分支继续使用 isTlsCertError，
     * 不扩大进程级关闭证书校验的触发面。
     */
    private isTlsTrustChainError;
    /** 连接级错误（代理不可达） */
    private isConnectionError;
}
