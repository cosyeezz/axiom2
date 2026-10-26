import { type Session } from '../../vendor/cbc-core/node/index.js';
/** What {@link adoptUpstreamPromptMeta} took from a prompt, for the caller's log. */
export interface AdoptedUpstreamPromptMeta {
    readonly promptRequestId?: string;
    /** An upstream promptRequestId that is not a W3C trace id, ignored. */
    readonly invalidPromptRequestId?: string;
    /** The prompt came from a background automation. */
    readonly automation: boolean;
}
export interface AdoptUpstreamPromptMetaOptions {
    /**
     * Whether `mode` becomes the session's scene (default). Server queries keep the scene
     * in the turn's baggage; readers resolve it per turn (`resolveRequestScene`), and only
     * a custom model endpoint, which gets the session scene, is left without it.
     */
    readonly sessionScene?: boolean;
}
/**
 * 采纳 Renderer 透传的上游元数据（`_meta['codebuddy.ai']`）。
 *
 * - `mode`：会话场景，写入 `session.meta`（`sessionScene: false` 时不写）；非专家提示同时清掉上一轮的 expertId。
 * - `promptRequestId`：Renderer 每次 send/resend 生成的全链路业务关联 ID，
 *   用于 Desktop main 埋点 + Galileo reporter 串联，不影响 CLI 自管理的
 *   conversationRequestId / traceId。
 * - `userId` / `conversationId` / `expertId`：写入 `session.meta` 供下游 trace attribute / 埋点取用。
 * - `agentRuntime`：业务指定的 X-Agent-Runtime（local-agent / cloud-agent / agent-agent，
 *   非法值归一为 other），写入 `session.meta` 后对本会话后续请求持续生效。
 * - `isAutomationBackground`：自动化触发的请求，X-Agent-Purpose 带 automation。
 */
export declare function adoptUpstreamPromptMeta(session: Session, codebuddyMeta?: Record<string, unknown>, { sessionScene }?: AdoptUpstreamPromptMetaOptions): AdoptedUpstreamPromptMeta;
/**
 * A server query's upstream metadata in the shape {@link adoptUpstreamPromptMeta} reads:
 * the `codebuddy.ai` extension, with promptRequestId / clientSendTime from baggage when present.
 */
export declare function queryUpstreamPromptMeta(meta: Record<string, unknown> | null | undefined): Record<string, unknown>;
/**
 * 同步写入 session.telemetry 供 model-provider 计算 message 维度模型视角 TTFT；返回写入的时间。
 * session.telemetry 此时可能尚未初始化（interceptor 在 agent run 时才创建），需确保存在。
 */
export declare function markPromptStart(session: Session): number;
