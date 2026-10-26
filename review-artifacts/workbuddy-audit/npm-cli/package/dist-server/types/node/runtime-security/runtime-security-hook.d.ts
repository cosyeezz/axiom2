import type { RemoteRuntimeSecurity, RuntimeSecurityScene } from '@genie/product';
import { Hook, HookEvent, type HookExecutionResult, type HookInput, HookPriority } from '../hooks/hook-protocol';
import { RuntimeSecurityAuditService, RuntimeSecurityPolicyProvider } from './runtime-security-protocol';
/** Skip cancel/framework failures with no model-visible body. */
export declare function shouldSkipToolResultAudit(input: HookInput): boolean;
declare abstract class RuntimeSecurityHookBase implements Hook {
    abstract readonly event: HookEvent;
    abstract readonly scene: RuntimeSecurityScene;
    readonly priority = HookPriority.Highest;
    protected readonly policyProvider: RuntimeSecurityPolicyProvider;
    protected readonly auditService: RuntimeSecurityAuditService;
    execute(input: HookInput): Promise<HookExecutionResult | undefined>;
    protected audit(input: HookInput, policy: RemoteRuntimeSecurity): Promise<HookExecutionResult | undefined>;
}
export declare class RuntimeSecurityPromptHook extends RuntimeSecurityHookBase {
    readonly event = HookEvent.USER_PROMPT_SUBMIT;
    readonly scene: "prompt";
    protected audit(input: HookInput, policy: RemoteRuntimeSecurity): Promise<HookExecutionResult | undefined>;
}
export declare class RuntimeSecurityPreToolHook extends RuntimeSecurityHookBase {
    readonly event = HookEvent.PRE_TOOL_USE;
    readonly scene: "toolCall";
}
export declare class RuntimeSecurityPostToolHook extends RuntimeSecurityHookBase {
    readonly event = HookEvent.POST_TOOL_USE;
    readonly scene: "toolResult";
    protected audit(input: HookInput, policy: RemoteRuntimeSecurity): Promise<HookExecutionResult | undefined>;
}
export declare class RuntimeSecurityPostToolFailureHook extends RuntimeSecurityHookBase {
    readonly event = HookEvent.POST_TOOL_USE_FAILURE;
    readonly scene: "toolResult";
    protected audit(input: HookInput, policy: RemoteRuntimeSecurity): Promise<HookExecutionResult | undefined>;
}
export {};
