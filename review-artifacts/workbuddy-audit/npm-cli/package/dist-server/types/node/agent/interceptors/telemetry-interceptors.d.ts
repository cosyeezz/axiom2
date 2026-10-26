import { AgentManager, AgentRunInterceptor, AgentRunInterceptorPriority, AgentRunRequest } from '../../../vendor/cbc-core/node/index.js';
import { Logger } from '@genie/telemetry';
import { FrictionAnalysisService, TelemetryService } from '../../telemetry';
export declare class TelemetryAgentRunInterceptor implements AgentRunInterceptor {
    priority: AgentRunInterceptorPriority;
    protected readonly agentManager: AgentManager;
    protected readonly logger: Logger;
    protected readonly telemetryService: TelemetryService;
    protected readonly frictionAnalysisService: FrictionAnalysisService;
    intercept(request: AgentRunRequest): Promise<void>;
    /**
     * Check whether the given purpose value was left over from a compact cycle.
     * If so, the interceptor should overwrite it for the next user request to
     * prevent stale compact purposes from leaking into normal conversation traces.
     */
    private isCompactPurpose;
    /**
     * 消费 `conversation:compact` 的一次性凭据，返回本轮是否应保留该 purpose。
     *
     * 凭据无论 purpose 是否匹配都会被清掉，避免它在"压缩后 purpose 又被 memory
     * extraction 等调用方覆盖"的路径上残留，隔几轮才被兑付。
     */
    private consumePendingCompactPurpose;
    /**
     * 取 RunState input 的最后一条 history 项；input 为 string/array/undefined/null 时返回 undefined。
     * Issue #65138: input 可能为 undefined（sub-agent 路径 schema 必填但运行时无 parse 校验时透传），
     * 裸读 .history 会抛 'reading history'。
     */
    private getLastInputMessage;
}
/**
 * 假 run 的 abort 在 AgentService.run 入口就装上，Env 等后续 interceptor 仍可能 await。
 * 必须在链首记下诊断句柄，calculateSession 才不会把并发真实 run 的 controller 当成自己的。
 */
export declare class TokenCalculationAbortSnapshotInterceptor implements AgentRunInterceptor {
    priority: AgentRunInterceptorPriority;
    intercept(request: AgentRunRequest): Promise<void>;
}
export declare class TokenCalculationAgentRunInterceptor implements AgentRunInterceptor {
    priority: AgentRunInterceptorPriority;
    protected readonly logger: Logger;
    intercept(request: AgentRunRequest): Promise<void>;
}
