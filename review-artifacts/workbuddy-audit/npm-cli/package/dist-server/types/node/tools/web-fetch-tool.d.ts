import { AuthenticationManager } from '@genie/authentication';
import { PromptRenderer, Session } from '../../vendor/cbc-core/node/index.js';
import { type FunctionCallItem, RunContext, ToolArg, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { ClientInfoProvider, ProductManager } from '@genie/product';
import { Logger } from '@genie/telemetry';
import { z } from 'zod';
import { GalileoService } from '../galileo';
import { CustomHeadersProvider } from '../http';
import { ThreatDomainChecker } from '../sandbox-cli/threat-domain-checker';
import { type SandboxCenterIpcClient } from '../sensitive-content/sandbox-center-ipc-client-protocol';
import { SettingsManager } from '../settings';
import { type SandboxTelemetryReporter as ISandboxTelemetryReporter } from '../telemetry/sandbox-telemetry-protocol';
import { BaseTool } from './base-tool';
import { type SandboxWriteRuleGuard } from './sandbox-write-rule-guard';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
declare const WebFetchParameters: z.ZodObject<{
    url: z.ZodString;
    prompt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    url: string;
    prompt: string;
}, {
    url: string;
    prompt: string;
}>;
export declare class WebFetchTool extends BaseTool implements Tool {
    protected readonly promptRenderer: PromptRenderer;
    protected readonly logger: Logger;
    protected readonly sandboxCenterClient?: SandboxCenterIpcClient;
    protected readonly sandboxWriteRuleGuard?: SandboxWriteRuleGuard;
    protected readonly productManager: ProductManager;
    protected readonly authenticationManager: AuthenticationManager;
    protected readonly clientInfoProvider: ClientInfoProvider;
    protected readonly settingsManager: SettingsManager;
    protected readonly customHeadersProvider: CustomHeadersProvider;
    protected readonly galileoService: GalileoService;
    protected readonly threatDomainChecker?: ThreatDomainChecker;
    protected readonly sandboxTelemetryReporter?: ISandboxTelemetryReporter;
    private readonly WEB_FETCH_API_PATH;
    name: ToolNames;
    isConcurrencySafe(): boolean;
    resolveSensitiveEgress(input: z.infer<typeof WebFetchParameters>, context: RunContext<Session>): Promise<{
        source: "web-fetch";
        inspectionContent: string;
        destinationKey: string;
    } | undefined>;
    parameters: z.ZodObject<{
        url: z.ZodString;
        prompt: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        url: string;
        prompt: string;
    }, {
        url: string;
        prompt: string;
    }>;
    argumentRenderer: ToolCallArgumentRenderer;
    private static cache;
    /**
     * 已落审计的恶意域名拦截，键为 `sessionId + requestId + target`。
     *
     * 模型在同一个 turn 里换 path / query 反复访问同一个恶意域名很常见，逐次落审计会把
     * 安全中心刷成同一条内容的重复记录。沙箱侧有 `dedupeMaliciousNetworkBlockRecords` 做同样的事，
     * WebFetch 这条旁路缺了等价保护。静态成员按进程共享，与 `cache` 一致。
     */
    private static auditedMaliciousBlocks;
    resolveNeedPermissionArgs(_runContext: RunContext, input: z.infer<typeof WebFetchParameters>, _callId?: string): ToolArg[];
    needsApproval: (runContext: RunContext<Session>, input: z.infer<typeof WebFetchParameters>, callId?: string) => Promise<boolean>;
    /** Auto mode classifier projection: `${url}: ${prompt}` (Claude alignment, decision D1). */
    toAutoClassifierInput(input: unknown): string;
    execute(params: z.infer<typeof WebFetchParameters>, context: RunContext<Session>, details?: {
        toolCall: FunctionCallItem;
    }): Promise<ToolResult>;
    /**
     * 图片 / 二进制没有可摘要文本。直接返回 Bash+Read 指引，
     * 跳过 AI summary，也不写入缓存——同一 URL 下次可能变成普通页面。
     */
    private returnNonTextResourceGuidance;
    /**
     * 空正文不是抓取失败，但也没有可分析的内容：给出明确结论，不进 AI 分析。
     * 此前空内容会被送进 CONTENT_ANALYZER，它的自述回复（"网页内容部分是空的" + 模板话术）
     * 会被当作抓取结果返回给模型，看起来像正文、实则与页面无关。
     */
    private returnEmptyTextGuidance;
    private recordMaliciousWebsiteAudit;
    /** Check whether the remote API is disabled via environment variable or product feature. */
    private isRemoteApiDisabled;
    /**
     * Race strategy: launch remote API and local fetch concurrently.
     * - If remote succeeds within WEB_FETCH_API_TIMEOUT_MS (20s), use remote result.
     * - If remote fails or times out, use local fetch result (already in-flight).
     * This eliminates sequential latency — local fetch warms up in parallel.
     *
     * When CODEBUDDY_DISABLE_WEB_FETCH_REMOTE_API=true, skip remote API entirely and use local fetch only.
     */
    private fetchWithFallback;
    private validateParams;
    private normalizeUrl;
    private getCachedEntry;
    private setCachedContent;
    private cleanExpiredCache;
    /**
     * Fetch content via the backend /agenttool/v1/webfetch API which returns markdown directly.
     * The caller owns the deadline via `abortSignal` — when triggered, both the promise rejects
     * and the underlying socket is closed.
     */
    private fetchContentViaApi;
    private resolveCurrentModelName;
    /**
     * Local fallback: fetch the URL directly and convert HTML to markdown using turndown.
     */
    private fetchAndProcessLocally;
    /**
     * Extract useful information from HTML meta tags when body content is empty.
     * This is particularly useful for SPA pages where the actual content is rendered by JavaScript.
     */
    private extractMetaContent;
    private fetchWithTimeout;
    /**
     * WebFetch 的统一 URL 放行入口。
     *
     * 判定层级：有序规则首命中 → 恶意库。命中 allow 则跳过恶意库；其余再查
     * sandbox-cli/Rust 只读 SQLite，与沙箱网络请求共用同一套哈希、主域和子域匹配。
     */
    private assertUrlAllowed;
    /**
     * 下游 KInfra 为「不可外链、只能内部读取」资源（如会议录制）构造的假 url 定位符：
     * https://meeting.kinfra.invalid/record/<id>。.invalid 是 RFC 2606 保留域、永不解析，
     * 本地不会真正出网（正文由服务端向 KInfra 换取），因此跳过网络审批弹窗。
     */
    private isKinfraReservedLocator;
    private networkTargetKey;
    /**
     * 恶意域名库判定：命中抛 `MaliciousWebsiteBlockedError`，其余情形静默返回。
     *
     * 从 `assertUrlAllowed` 拆出来，是为了让 `*` deny / default_rule 排在本检查之后。
     * 写成一段顺序代码的话，中间那几个「不查库」的早退（没有 checker、IP 字面量、
     * 库不可用）会连这条有序规则一起跳过，把 catch-all deny 放成通过。
     */
    private assertNotMaliciousDomain;
    protected summaryTimeoutMs: number;
    private processContentWithAI;
    private createSummaryTimeoutResponse;
    private createAnalysisPrompt;
    private createFallbackPrompt;
    private createFallbackResponse;
    private createContentSummary;
    /**
     * 安全中心：网络拒绝/放行域名检查。
     *
     * allow/ask/deny 与是否命中 allow 一律来自 Center `decide_network`。
     * 有序规则首命中后才查恶意库。`*` deny 在 sandbox 侧会映射成 `cfg.default_rule`，
     * Center 带 `deferToThreatCheck`，好让恶意库先认领归因——否则 catch-all 期间
     * 所有恶意命中都会被记成普通策略拒绝。判决两种顺序都是拦，差的只有归因。
     *
     * 规则同步和运行时裁决都由 Center 负责，避免 Genie 与 Sandbox 使用不同的
     * 本地配置快照。
     */
    private checkNetworkPolicy;
    private interpretCenterNetworkDecision;
    /**
     * Emit a structured webfetch event to Galileo. Captures:
     *   - which fetch path won (cache / api / local fallback)
     *   - whether AI summary was triggered
     *   - per-branch content lengths and durations (so the dashboard can compare api vs. local)
     *   - URL host only (no full URL — avoid PII / sensitive query strings)
     * Failures are swallowed; telemetry must not break the tool's main flow.
     */
    private reportTelemetry;
    /**
     * Extract host + path from URL safely. Returns host/path separately so the dashboard
     * can group by host or drill into a specific page. Querystring is intentionally dropped
     * to avoid leaking tokens / search keywords / other PII embedded in URL params.
     */
    private safeUrlParts;
    /** Truncate string to N chars to keep telemetry attribute payloads bounded. */
    private truncate;
}
export {};
