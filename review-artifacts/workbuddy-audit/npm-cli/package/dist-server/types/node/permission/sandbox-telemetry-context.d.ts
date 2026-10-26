import type { SandboxToolCallRoute, SandboxTurnDisabledReason } from '@genie/telemetry';
import type { SandboxTelemetryContext } from './sandbox-orchestrator-protocol';
interface SandboxTelemetrySession {
    id: string;
    conversationRequestId?: string;
    messageId?: string;
    meta?: {
        rootRequestId?: unknown;
        parentSessionId?: unknown;
    };
}
interface SandboxTelemetryContextDiagnostics {
    warn?: (message: string) => void;
}
/** 只返回当前稳定策略能证明的 Sandbox 预期，未知样本保持 undefined。 */
export declare function deriveSandboxExpected(route: SandboxToolCallRoute, routeReason: string): boolean | undefined;
/** 保存旁路上报状态，不向 Session.meta 注入业务字段。 */
export declare function setSandboxTurnDisabledReason(session: object, reason: SandboxTurnDisabledReason | undefined): void;
export declare function getSandboxTurnDisabledReason(session: object): SandboxTurnDisabledReason | undefined;
/** 记录 ACP 最近一次成功应用到 CLI 的 Sandbox 开关状态，仅用于归因。 */
export declare function setSandboxConfigApplicationState(session: object, enabled: boolean): void;
export declare function getSandboxConfigApplicationState(session: object): {
    enabled: boolean;
} | undefined;
/** 在 ToolCall 入口固化 Session 关联信息，避免异步弹窗期间串 Session。 */
export declare function createSandboxTelemetryContext(session: SandboxTelemetrySession, diagnostics?: SandboxTelemetryContextDiagnostics): SandboxTelemetryContext;
export {};
