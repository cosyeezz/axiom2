import { type CreateElicitationResponse } from '@genie/agent-client-protocol';
import { Session } from '../../vendor/cbc-core/node/index.js';
import { Logger } from '@genie/telemetry';
import { AcpAgent } from '../acp/acp-protocol';
import { SdkElicitationClient, SdkHooksManager } from '../control-signal/control-signal-protocol';
import { type HostElicitation } from './session-elicitation';
/**
 * QR / 表单类交互远超单次交互点击时间尺度；与 AskService 的 10 分钟一致。
 * 调用方可通过 `elicit(options.timeoutMs)` 覆盖。
 */
export declare const ELICITATION_DEFAULT_TIMEOUT_MS: number;
/** Prevent an untrusted client response from adding unbounded text to model context. */
export declare const ELICITATION_RESPONSE_REASON_MAX_LENGTH = 2000;
/**
 * elicitation 通道目标。三条等价通道，协议形状一致（参数命名对齐 ACP）：
 * - acp：ACP 会话，经 `elicitation/create` + `elicitation/complete`；
 * - sdk：stream-json（agent-sdk-js），经 control-signal `elicitation_create`
 *   请求 + `elicitation` 频道通知；
 * - host：服务模式，经宿主提供的 `QueryOptions.elicitation`（同 ACP 一对方法）。
 */
export type ElicitationTarget = {
    kind: 'acp';
    agent: AcpAgent;
    acpSessionId: string;
} | {
    kind: 'sdk';
    acpSessionId: string;
} | {
    kind: 'host';
    elicitation: HostElicitation;
    acpSessionId: string;
};
export interface ElicitationRequestPayload {
    /**
     * 顶部提示语（客户端渲染在表单上方）。ACP 官方位置。
     */
    message?: string;
    /**
     * 收集的结构化答复的受限 JSON Schema。与 MCP elicitation 保持一致。
     * 传空 `{ type: 'object', properties: {} }` 表示"不收集内容，只等
     * accept/decline/cancel"（同 payment 卡片的用法）。
     */
    requestedSchema: Record<string, unknown>;
    /**
     * 可选：本次调用触发该 elicitation 的工具调用 id。写进 ACP 官方
     * `SessionScope.toolCallId`，用于挂靠到具体的 tool_call 卡片。
     */
    toolCallId?: string;
    /**
     * 可选：SDK ≥0.25 提供的 elicitation id，跨越 create/complete 关联同一
     * 张卡片。省略时由本 service 生成一个 `elic_<ts>_<rand>` id。
     */
    elicitationId?: string;
    /**
     * 可选：附加 `_meta` 字段。会与本 service 生成的 `_meta['codebuddy.ai']`
     * 合并（浅合并到 `codebuddy.ai` 子键下）。
     */
    metaCodebuddyAi?: Record<string, unknown>;
}
export interface ElicitOptions {
    /** 覆盖默认 10 分钟超时。传 0 / 非有限值走默认。 */
    timeoutMs?: number;
    /** 外部 abort 信号；触发时按 cancel 语义收敛并 dismiss 卡片。 */
    signal?: AbortSignal;
}
export declare const ElicitationService: unique symbol;
export interface ElicitationService {
    /**
     * 根据 session 解析可用的 elicitation 通道。返回 undefined 表示当前
     * 会话不满足派发条件（无 ACP 连接 / 未声明 capability / 非 stream-json /
     * 非 form 模式），调用方应回退到 LLM-mediated 或直接失败。
     */
    resolveTarget(session: Session): ElicitationTarget | undefined;
    /**
     * 下发 elicitation 并等待用户响应。永不 throw（包括超时/abort/传输错误），
     * 按 ACP 官方扁平形状返回 `{ action, content?, _meta? }`；abort/timeout/
     * 传输错误统一 map 成 `{ action: 'cancel' }`，且会尽力发一次
     * `elicitation/complete` 让客户端把卡片翻掉。
     */
    elicit(target: ElicitationTarget, payload: ElicitationRequestPayload, options?: ElicitOptions): Promise<CreateElicitationResponse>;
    /**
     * 从响应里提取 `action` 标签；非法形状（老客户端 catch-all 回的 question
     * 形状）返回 undefined，调用方按 cancel 处理。
     */
    responseAction(response: CreateElicitationResponse | undefined): 'accept' | 'decline' | 'cancel' | undefined;
    /**
     * 读取 CodeBuddy 扩展槽中的通用原因。只接受非空字符串，不解释或映射内容；
     * 超长值会在安全上限处截断，避免宿主回包无限放大模型上下文。
     */
    responseReason(response: CreateElicitationResponse | undefined): string | undefined;
}
export declare class ElicitationServiceImpl implements ElicitationService {
    protected readonly sdkHooksManager: SdkHooksManager;
    protected readonly sdkElicitationClient?: SdkElicitationClient;
    protected readonly logger: Logger;
    private idCounter;
    resolveTarget(session: Session): ElicitationTarget | undefined;
    responseAction(response: CreateElicitationResponse | undefined): 'accept' | 'decline' | 'cancel' | undefined;
    responseReason(response: CreateElicitationResponse | undefined): string | undefined;
    elicit(target: ElicitationTarget, payload: ElicitationRequestPayload, options?: ElicitOptions): Promise<CreateElicitationResponse>;
    /**
     * Best-effort 关掉客户端仍在显示的 elicitation 卡片（超时 / abort /
     * 传输错误后）。同 payment 侧的语义，只是不带业务终态载荷。
     */
    private dismiss;
}
