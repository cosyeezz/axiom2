import { type CreateElicitationResponse } from '@genie/agent-client-protocol';
import { Session } from '../../vendor/cbc-core/node/index.js';
import { FunctionCallItem, RunContext } from '../../vendor/cbc-shared/node/index.js';
import { ProductManager } from '@genie/product';
import { Logger } from '@genie/telemetry';
import { SdkElicitationClient, SdkHooksManager } from '../control-signal/control-signal-protocol';
import { McpToolResultContent } from '../mcp/mcp-protocol';
import { Tool, ToolResult } from '../tools/tool-protocol';
import { PaymentInterceptor, WeixinPayService } from './payment-protocol';
/**
 * Extract the action tag from a CreateElicitationResponse（官方扁平形状
 * {action: 'accept'|'decline'|'cancel', content?}）。非法形状（如老客户端
 * catch-all 回的 question 形状）返回 undefined，调用方按 cancel 处理。
 */
export declare function elicitationActionTag(response: CreateElicitationResponse | undefined): 'accept' | 'decline' | 'cancel' | undefined;
/** 本地关闭微信支付运行时拦截（`WeixinPay-Required` 识别）的 env 变量名。 */
export declare const WEIXINPAY_INTERCEPTION_ENV_VAR = "CBC_WEIXINPAY_INTERCEPTION";
/**
 * env 是否显式关闭微信支付拦截。语义同 mods 的 `CBC_ENABLE_FUNCTION_HOOKS`：
 * 默认开，仅 `0` / `false` / `no` / `off`（大小写不敏感、允许前后空格）才关；
 * 未设、空串、truthy 或未识别值都按开处理。Exported for tests.
 */
export declare function isWeixinPayInterceptionDisabledByEnv(env?: NodeJS.ProcessEnv): boolean;
/**
 * weixinpay 自有工具的回复默认**不**重复扫描（pay 的确认链接等由拦截器自身产生，
 * 再扫会回环）；唯一例外是 weixinpay_retry_pay —— 它格式化订单信息、产出**新的**
 * 支付触发（WeixinPay-Required）供 agent 重新发起支付，必须被扫描命中以
 * 渲染确认卡，故不在排除之列。toolName 一般是 mcp__weixinpay__<tool> 全名，取末段
 * 比较以兼容潜在裸名。Exported for tests.
 */
export declare function isExcludedWeixinpayOwnReply(serverName: string, toolName: string): boolean;
/**
 * Runtime (host-mediated) WeChat-Pay interception.
 *
 * Flow: tool result → WeixinDetector → capability negotiation → PayService
 * (builtin weixinpay MCP tool) → suspend on ACP `elicitation/create` →
 * accept/decline/cancel → 原始结果追加受控终点文本（不脱敏：凭证一次性 +
 * 服务端幂等，重复发起不会重复扣款）。
 *
 * Every gate falls through to "return undefined" (pass the original result
 * through untouched) so non-eligible runtimes — TUI, --print, 未声明
 * elicitation 能力的 stream-json/SDK 会话, 助理/claw sessions whose
 * per-session ACP client doesn't declare the elicitation capability, hosts
 * without the builtin plugin — keep today's LLM-mediated behavior.
 * stream-json 会话在 SDK 于 initialize 声明 capabilities.elicitation.form
 * 后走 control-signal 通道收发同形 elicitation（见 SdkElicitationClient）。
 */
export declare class PaymentInterceptorImpl implements PaymentInterceptor {
    protected readonly payService: WeixinPayService;
    protected readonly sdkHooksManager: SdkHooksManager;
    protected readonly sdkElicitationClient: SdkElicitationClient;
    protected readonly productManager: ProductManager;
    protected readonly logger: Logger;
    scan(tool: Tool, toolResult: ToolResult, context?: RunContext<Session>, details?: {
        toolCall: FunctionCallItem;
    }): Promise<ToolResult | undefined>;
    scanMcpResult(serverName: string, toolName: string, content: McpToolResultContent, session?: Session): Promise<McpToolResultContent | undefined>;
    /**
     * Detector already hit. Run gating + pay + elicitation; returns the
     * controlled status text for the model, or undefined to pass through.
     */
    private runPaymentFlow;
    /**
     * 流程终点 → 交给模型的受控文本（时序图契约：终点交付服务端
     * additional_context；to_user 一并携带供模型转述）。
     *
     * 文案完全依赖插件：additional_context 缺失（协议破损，正常流量不发生）时
     * 返回 undefined —— 调用方一路透传原始工具输出，与拦截器其它门控的
     * fail-open 退化完全一致，不本地拼凑任何话术。无回复体的终点（调用异常/
     * 断连）由调用方传入本地兜底 context。
     */
    private endpointText;
    /**
     * 查单终点文案。paid/failed/pending 按构造必有回复体（parseQueryReply 读
     * payment_status），文案完全依赖插件（缺失 → undefined 透传）；queryError
     * 可能来自调用异常/server 断连（无回复体），是唯一保留本地兜底的查单终点。
     */
    private queryEndpointText;
    private elicitConfirm;
    /**
     * 读拦截总开关：先看 env `CBC_WEIXINPAY_INTERCEPTION`（显式 0/false/no/off 即关），
     * 再读 productFeatures.WeixinPayInterception。默认 enable：字段缺失或
     * 读取异常都返回 true（不让默认功能因读配置失败被意外关掉）；只有配置中心
     * 经 /v3/config 显式下发 false 才返回 false。product 配置在 WorkBuddy 桌面端
     * 由主进程合并远程 overlay 后经 ACC_PRODUCT_CONFIG_V3 注入 CLI。
     */
    private isInterceptionEnabled;
    /**
     * Capability negotiation（两条通道，门控均前置于 pay() 的真实下单副作用）：
     * - ACP 会话：还活着的 per-connection agent 且 initialize 声明了
     *   elicitation.form。桌面端按会话声明（claw/助理会话故意不声明），一个
     *   检查同时覆盖运行态阶梯与 claw 排除。ACP 会话只走这条，未声明即透传
     *   （不会落到 SDK 分支）。
     * - SDK(stream-json) 会话：SDK 在 initialize control_request 声明了
     *   capabilities.elicitation.form（进程级存储，门控先例同 AskUserQuestion）。
     *   老 SDK 不声明 → 透传，保持 LLM-mediated；这是生命线——老 SDK 对未知
     *   control subtype 静默丢弃且不回包。
     * - 服务模式：宿主经 `QueryOptions.elicitation` 提供通道即可发卡（宿主只在
     *   客户端声明 elicitation.form 时提供，门控在宿主侧，与上两条同义）。
     */
    private resolveElicitationTarget;
    /**
     * Push elicitation/create（SDK ≥0.25 typed API）and await the user's
     * action, racing the session abort signal (cancel must not wedge the
     * turn) and a timeout. Returns undefined only on transport errors;
     * abort/timeout map to cancel, with a best-effort elicitation/complete
     * notification so the client can dismiss the now-stale card (otherwise
     * a late click would locally show "已确认支付" the agent never saw).
     */
    private elicit;
    /**
     * Best-effort 关掉客户端仍在显示的 elicitation 卡片（超时/中止/查单判定后）。
     * 查单得到的终态（paid 含金额）随 _meta 下发，客户端据此把卡片翻成
     * 「支付成功」结果卡而非一律按取消处理。acp 经 elicitation/complete；
     * sdk 经 control_notification 'elicitation' 频道（同语义，fire-and-forget）。
     */
    private dismissElicitation;
    /**
     * 卡片展示期间的查单窗口（时序图②）：单次 weixinpay_query_pay wait=true ——
     * 插件侧阻塞轮询（spawn CLI --poll，最长约5分钟），用户取消经 signal →
     * MCP notifications/cancelled → 插件 kill 轮询子进程。
     *
     * 终态语义（窗口结束即流程终点，文案由调用方取 additional_context）：
     * - paid → accept（卡片翻支付成功结果卡，带金额）
     * - failed / queryError → cancel
     * - pending：wait 正常应已阻塞到位 —— 服务端早退时窗口内小间隔重发；
     *   窗口耗尽仍 pending 则按终点收口（不无限轮询）。
     * - unsupported（非中止，仅 MCP server 断连）→ 按 queryError 终点收口（cancel）。
     * - signal 中止：永不 resolve，退化为 elicit 的 abort 分支收尾。
     */
    private runQueryWindow;
    /**
     * Sleep that resolves true on timeout, false when the abort signal fires first.
     * 正常到点时显式移除 abort 监听器（{once} 只在 abort 触发时自动移除）——
     * runQueryWindow 的重试循环复用同一个 signal，否则监听器会在查询窗口内累积
     * 并触发 MaxListenersExceededWarning。
     */
    private delay;
    private newElicitationId;
}
