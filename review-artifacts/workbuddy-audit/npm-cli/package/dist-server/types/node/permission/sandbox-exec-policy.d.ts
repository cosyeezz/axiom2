/**
 * Agent 侧静态命令安全策略适配器。
 *
 * 产品层提供 builtin 规则，sandbox-cli 负责匹配；本层保留 DI、用户配置与日志。
 */
import { Logger } from '@celljs/core';
import { type SandboxExecDecision, type SandboxExecPolicy as ISandboxExecPolicy, type SandboxExecPolicyMatch, type SandboxExecPolicyRule, type SandboxExecPolicyUserRules } from './sandbox-exec-policy-protocol';
export { BUILTIN_ALLOW_RULES, BUILTIN_FORBIDDEN_RULES } from './sandbox-exec-policy-builtin';
export declare class SandboxExecPolicyImpl implements ISandboxExecPolicy {
    protected readonly logger: Logger;
    private matchPolicy;
    setUserRules(rules: SandboxExecPolicyUserRules | undefined): void;
    match(command: string): SandboxExecPolicyMatch;
}
export type { SandboxExecDecision, SandboxExecPolicyMatch, SandboxExecPolicyRule, SandboxExecPolicyUserRules, };
