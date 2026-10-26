import { Session } from '../../vendor/cbc-core/node/index.js';
import { Logger } from '@genie/telemetry';
import { AgentScopedMcpManager, McpManager, McpToolResultContent } from '../mcp/mcp-protocol';
import { WeixinPayInput, WeixinPayOutcome, WeixinPayQueryOutcome, WeixinPayService } from './payment-protocol';
/** Raw .mcp.json server key registered by the builtin weixinpay plugin. */
export declare const WEIXINPAY_MCP_SERVER_NAME = "weixinpay";
/** Full registry name of the pay tool (mcp__<server>__<rawTool>). */
export declare const WEIXINPAY_PAY_TOOL_NAME = "mcp__weixinpay__weixinpay_pay";
/** Full registry name of the pay-result query tool（入参 query_result_id）。 */
export declare const WEIXINPAY_QUERY_TOOL_NAME = "mcp__weixinpay__weixinpay_query_pay";
/**
 * Raw tool name of the retry-pay tool（全名 mcp__weixinpay__weixinpay_retry_pay）。
 * 新增工具：格式化订单信息供 agent 重新发起支付。与 pay/query 等"自有回复不重复
 * 扫描"的工具不同，它产出**新的**支付触发（WeixinPay-Required），需被
 * PaymentInterceptor 扫描命中以渲染确认卡，故 scanMcpResult 对它保留检测。
 */
export declare const WEIXINPAY_RETRY_PAY_TOOL = "weixinpay_retry_pay";
/**
 * E2E 调试钩子：在没有真实支付链路（未绑卡 / 测试环境）时验证
 * "拦截 → 挂起 → 推卡 → 回传 → 脱敏" 全链路。
 *
 * WEIXINPAY_MOCK_OUTCOME 取值：
 *   - 'confirm:<url>'  模拟已绑卡支付（is_registered=true，<url> 渲染二维码，"授权支付"）
 *   - 'bind:<url>'     模拟未绑卡（is_registered=false，<url> 渲染二维码，"绑定并授权支付"）
 *   - 'autoCharged'    模拟短期授权自动扣款（无卡）
 *   - 其他非空值       模拟支付失败（透传路径）
 *
 * 设置后跳过真实 MCP 调用且 isAvailable() 恒为 true；不设置则完全无效。
 * Exported for tests.
 */
export declare function readMockOutcome(env?: NodeJS.ProcessEnv): WeixinPayOutcome | undefined;
/**
 * mock 查单终态控制（仅在 WEIXINPAY_MOCK_OUTCOME 生效时有意义）。环境变量
 * WEIXINPAY_MOCK_QUERY = `<kind>[:<delayMs>]`：
 *   - 未设置          → undefined：host 查单窗口阻塞驻留（卡片留在屏上供查看），
 *                       直到用户取消（abort）。模拟"用户尚未扫码完成"。
 *   - 'paid[:ms]'     → ms 毫秒后（默认 0）回 paid（带 mock 金额），卡片翻支付成功
 *   - 'failed[:ms]'   → failed，卡片翻"支付未完成"
 *   - 'pending[:ms]'  → pending，卡片翻"支付结果未确认"
 * 带延迟便于在本地点过 授权页 → 扫码页 后再看到卡片自动翻终态。
 * Exported for tests.
 */
export declare function readMockQueryOutcome(env?: NodeJS.ProcessEnv): {
    outcome: WeixinPayQueryOutcome;
    delayMs: number;
} | undefined;
/**
 * mock 模式的查单实现：按 WEIXINPAY_MOCK_QUERY 解析终态，可被 signal 中止
 * （abort → unsupported，与真实查单被取消时一致）。未配置终态时永不主动 resolve，
 * 让卡片驻留供 UI 查看，直到用户取消。Exported for tests.
 */
export declare function mockQueryResult(signal?: AbortSignal, env?: NodeJS.ProcessEnv): Promise<WeixinPayQueryOutcome>;
/**
 * Parse the weixinpay_pay reply into a structured outcome.
 *
 * 新协议（MCP 0.5.20+）返回 JSON 字符串的 PayService result：
 *   { pay_service_ver, prompt, to_user, success, data?: { mode, ui }, error? }
 * - success === false                → error（code/message + to_user）
 * - success && data.mode === 'auto'  → autoCharged（短期授权已扣款，无卡）
 * - success && data.mode === 'confirm' → confirm 卡（data.ui，按 is_registered 切文案；
 *   data.declined_context 为取消/超时未授权时的受控文案，原样带回 declinedContext）
 * 非 JSON / 缺 pay_service_ver 的返回按 error 透传（不再解析旧 markdown）。
 * Exported for tests.
 */
export declare function parseWeixinPayReply(rawText: string): WeixinPayOutcome;
/**
 * 解析 weixinpay_query_pay 的查单回复（插件 ≥1.5 结构化协议）。
 *
 * 支付终态来自 `data.payment_status` ∈ 'success' | 'partial' | 'failed' |
 * 'pending' | 'unknown'（插件把"已绑定但支付未终态"/"已扫码未完成"归为
 * pending）——只读结构化字段，不做文案推断。同时带回 to_user /
 * additional_context（流程终点交付模型）与 ui.pay_amount / ui.title
 * （成功结果卡渲染）。查单调用失败（success:false / 非协议回复）→ queryError；
 * payment_status 缺失 → pending（绝不误判完成）。
 * Exported for tests.
 */
export declare function parseQueryReply(rawText: string): WeixinPayQueryOutcome;
export declare class WeixinPayServiceImpl implements WeixinPayService {
    protected readonly mcpManager: McpManager;
    protected readonly agentScopedMcpManager?: AgentScopedMcpManager;
    protected readonly logger: Logger;
    isAvailable(session?: Session): Promise<boolean>;
    pay(input: WeixinPayInput): Promise<WeixinPayOutcome>;
    queryPayResult(queryResultId: string, opts?: {
        session?: Session;
        wait?: boolean;
        signal?: AbortSignal;
        timeoutMs?: number;
    }): Promise<WeixinPayQueryOutcome>;
    /**
     * A served session's own MCP comes first: there the Host declares weixinpay
     * for the session (`QueryOptions.mcpServers`) instead of the process loading it.
     */
    private getServer;
}
/** Concatenate the text items of an MCP result (mirrors DeferExecuteTool.convertMcpResult). */
export declare function flattenMcpText(content: McpToolResultContent | undefined): string;
