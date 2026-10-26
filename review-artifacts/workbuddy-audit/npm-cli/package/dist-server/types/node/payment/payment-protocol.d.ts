import type { Session } from '../../vendor/cbc-core/node/index.js';
import type { FunctionCallItem, RunContext } from '../../vendor/cbc-shared/node/index.js';
import type { McpToolResultContent } from '../mcp/mcp-protocol';
import type { Tool, ToolResult } from '../tools/tool-protocol';
export declare const PaymentInterceptor: unique symbol;
export declare const WeixinPayService: unique symbol;
/**
 * Host-mediated WeChat-Pay interception (runtime intercept + ACP elicitation).
 *
 * Both scan entry points are fail-open: any internal error, missing capability,
 * or unavailable PayService returns `undefined`, leaving the original tool
 * result untouched so the plugin's existing LLM-mediated flow (skills +
 * markdown link) keeps working — that is also the deliberate degradation path
 * for sessions whose ACP client did not advertise the elicitation capability
 * (e.g. 助理/claw sessions).
 */
export interface PaymentInterceptor {
    /**
     * Scan a builtin tool result (ToolManager.executeToolWithHooks choke point).
     *
     * @returns a replacement ToolResult (original content + appended controlled
     * payment status text) when the payment flow was handled out-of-band, else
     * undefined. 不脱敏：凭证一次性 + 服务端幂等，重复发起不会重复扣款。
     */
    scan(tool: Tool, toolResult: ToolResult, context?: RunContext<Session>, details?: {
        toolCall: FunctionCallItem;
    }): Promise<ToolResult | undefined>;
    /**
     * Scan an MCP tool result (McpServerManager callTool proxy choke point —
     * MCP tools never pass through executeToolWithHooks).
     *
     * @returns a replacement content array (original items + appended controlled
     * payment status text) when intercepted, else undefined.
     */
    scanMcpResult(serverName: string, toolName: string, content: McpToolResultContent, session?: Session): Promise<McpToolResultContent | undefined>;
}
/**
 * weixinpay_pay 返回的 PayService result `data.ui`（MCP 0.5.20+，camelCase 化）。
 * 绑定与支付统一为一张确认卡：`isRegistered=false` 时按钮/提示文案为绑定语义。
 */
export interface WeixinPayUi {
    /** data.ui.is_registered —— 是否已绑定 AI 专属卡。 */
    isRegistered: boolean;
    /** data.ui.web_url —— PC 扫码二维码链接（即时支付 claw_pay_url 或绑定 open_url）。 */
    webUrl: string;
    /** data.ui.scheme_url —— 微信 scheme 跳转链接（可在微信内直接打开）。 */
    schemeUrl: string;
    /** data.ui.title —— 卡片标题，如 'AI专属卡'。 */
    title: string;
    /** data.ui.confirm_text —— 主按钮文案（'授权支付' / '绑定并授权支付'）。 */
    confirmText: string;
    /** data.ui.scan_tip —— 扫码提示。 */
    scanTip: string;
    /** data.ui.cancel_text —— 取消按钮文案。 */
    cancelText: string;
}
/**
 * Parsed outcome of a weixinpay_pay MCP tool call (PayService result JSON).
 *
 * 新协议（MCP 0.5.20+）不再有独立的 'bind' 形态：未绑定通过 `confirm` 卡的
 * `ui.isRegistered=false` 体现。三态：confirm（弹卡）/ autoCharged（短期授权
 * 已自动扣款，无卡）/ error（透传）。`toUser` 是服务端给模型的受控文本。
 */
export type WeixinPayOutcome = 
/**
 * 需要用户确认的支付/绑定卡（data.mode='confirm'）。queryResultId 为查询句柄
 * （data.query_result_id）：host 在卡片展示期间用它调 weixinpay_query_pay
 * （wait=true 阻塞查询）拿真实支付终态，自动 resolve 卡片。
 * declinedContext（data.declined_context）：用户取消/超时未授权时交给模型的
 * 受控引导文案，由插件随发起回复预先下发——取代 host 端硬编码副本（缺失时
 * 调用方回退到本地 confirmDeclinedText）。
 */
{
    kind: 'confirm';
    ui: WeixinPayUi;
    toUser: string;
    additionalContext?: string;
    declinedContext?: string;
    queryResultId?: string;
}
/**
 * 短期意图授权，后端已自动扣款，无需交互（data.mode='auto'）。
 * 时序图要求 auto 也用 queryResultId 进查单确认后才把结果交给模型。
 */
 | {
    kind: 'autoCharged';
    toUser: string;
    additionalContext?: string;
    queryResultId?: string;
}
/** 支付发起失败（success:false）——流程终点，additionalContext 交给模型。 */
 | {
    kind: 'error';
    code?: number;
    message?: string;
    toUser?: string;
    additionalContext?: string;
};
/**
 * weixinpay_query_pay 查单结果（结构化 data.payment_status，插件 ≥1.5）。
 * 每个分支都带服务端给模型的 additionalContext（流程终点文案的唯一权威来源）。
 * - paid：支付成功（success/partial）→ 渲染结果卡（payAmount/title），accept 收口。
 * - failed：支付失败/取消/超时 → cancel 收口。
 * - pending：阻塞查询窗口结束仍未确认（pending/unknown）→ 终点，不误判完成。
 * - queryError：查单调用失败（reply error 或调用异常）→ 终点，引导稍后重试。
 * - unsupported：无句柄 / mock / server 不在 → 查单不启动，交回用户取消/超时。
 */
export type WeixinPayQueryOutcome = {
    kind: 'paid';
    toUser: string;
    additionalContext?: string;
    payAmount?: string;
    title?: string;
} | {
    kind: 'failed';
    toUser: string;
    additionalContext?: string;
} | {
    kind: 'pending';
    toUser: string;
    additionalContext?: string;
} | {
    kind: 'queryError';
    message?: string;
    toUser?: string;
    additionalContext?: string;
} | {
    kind: 'unsupported';
};
/**
 * Pay input handed to WeixinPayService.pay()：WeixinPay-Required 的 paymentCode。
 */
export interface WeixinPayInput {
    /** WeixinPay-Required 头/字段的值（一次性凭证，原样下发）。 */
    paymentCode: string;
    /** Session used for telemetry attribution and agentSessionId injection. */
    session?: Session;
}
/**
 * PayService backed by the builtin weixinpay plugin's MCP tool.
 *
 * It does NOT spawn the native WeChatPayCLI itself: it invokes the already
 * registered MCP tool `mcp__weixinpay__weixinpay_pay` (server key `weixinpay`,
 * seeded by WorkBuddy Desktop's builtin-plugins marketplace). When that server
 * is not connected (plugin absent, non-darwin, non-WB host...), the service
 * reports unavailable and payment interception is a no-op.
 */
export interface WeixinPayService {
    /** Whether the builtin weixinpay MCP server is connected (the session's own first). */
    isAvailable(session?: Session): Promise<boolean>;
    /** Run the pay flow through the MCP tool and parse the outcome. */
    pay(input: WeixinPayInput): Promise<WeixinPayOutcome>;
    /**
     * 查询支付结果（host 在卡片展示期间 / auto 模式下调用）。
     *
     * 接通 weixinpay_query_pay：wait=true 时由插件侧阻塞轮询（spawn CLI --poll，
     * 最长约 5 分钟），signal 中止会经 MCP notifications/cancelled 让插件 kill
     * 轮询子进程。返回结构化终态（见 WeixinPayQueryOutcome）。
     */
    queryPayResult(queryResultId: string, opts?: {
        session?: Session;
        wait?: boolean;
        signal?: AbortSignal;
        timeoutMs?: number;
    }): Promise<WeixinPayQueryOutcome>;
}
