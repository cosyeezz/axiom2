import type { AgentRetryReason, Session } from './session-protocol';
import { ModelRequestRetryPhase, SessionRunStateMachine } from './session-run-state-machine-protocol';
export declare class ModelRequestRetryPhaseImpl implements ModelRequestRetryPhase {
    protected readonly stateMachine: SessionRunStateMachine;
    during<T>(session: Session | undefined, reason: AgentRetryReason | undefined, wait: () => Promise<T>): Promise<T>;
    /**
     * 辅助型调用复用主 session 却不回送 AGENT_ENDED（#52320），不得驱动其状态；
     * 状态已离开 MODEL_REQUESTING 说明另有路径在推进，此时不抢写。
     */
    private enter;
    /**
     * 必须回到 MODEL_REQUESTING：RETRYING 不接收 TOOL_STARTED / MODEL_RESPONSE_DONE 等后续事件，
     * 停留会让错误处理路径的转换被静默忽略。已被取消等事件推走时不再改写。
     */
    private leave;
}
//# sourceMappingURL=model-request-retry-phase.d.ts.map