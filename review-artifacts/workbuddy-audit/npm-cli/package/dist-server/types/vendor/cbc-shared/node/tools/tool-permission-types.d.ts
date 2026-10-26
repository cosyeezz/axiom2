import type { PermissionMode } from '../settings/settings-types';
export declare enum ToolPermissionType {
    Read = "read",
    Bash = "bash",
    Edit = "edit",
    Unknown = "unknown"
}
export interface ToolArg {
    type: ToolArgType;
    value: string;
}
export declare enum ToolArgType {
    Unknown = "unknown",
    FilePath = "filePath",
    Command = "command",
    SlashCommand = "slashCommand",
    Skill = "skill",
    URL = "url"
}
/** Options for approving a tool. */
export interface ApprovalOptions {
    /** Whether to always approve this tool in the future */
    alwaysApprove?: boolean;
    /** Scope for the always-approve rule */
    scope?: ApprovalScope;
}
/** Rule behavior priority: deny > ask > allow. */
export type RuleBehavior = 'allow' | 'deny' | 'ask';
/** Parsed rule value - represents a single permission rule. */
export interface RuleValue {
    /** Tool name (e.g., "Read", "Edit", "Bash") */
    toolName: string;
    /** Optional rule content (e.g., file path pattern, command pattern) */
    ruleContent?: string;
}
/** Sources are merged; priority is between behaviors, not sources. */
export type SettingSource = 'policySettings' | 'flagSettings' | 'userSettings' | 'projectSettings' | 'localSettings' | 'cliArg' | 'command' | 'session' | 'sandbox';
/** Sources supported for always-approve persistence. */
export type ApprovalScope = Extract<SettingSource, 'session' | 'localSettings'>;
/** Sources that can be written to files. */
export declare const PersistableSettingSources: SettingSource[];
export interface Rule {
    source: SettingSource;
    behavior: RuleBehavior;
    value: RuleValue;
    /** Original rule string (e.g., "Bash(npm run build)") */
    originalRule: string;
}
/** Reason for the permission decision. */
export type DecisionReason = {
    type: 'rule';
    rule: Rule;
} | {
    type: 'mode';
    mode: PermissionMode;
} | {
    type: 'modeDeny';
    mode: PermissionMode;
    reason: string;
} | {
    type: 'asyncAgent';
    reason: string;
} | {
    type: 'workingDirectory';
} | {
    type: 'sensitiveFile';
    fileName: string;
} | {
    type: 'toolValidation';
    message: string;
} | {
    type: 'strategy';
    strategyMode: PermissionMode;
} | {
    type: 'default';
};
export interface RuleSuggestion {
    rule: RuleValue;
    behavior: RuleBehavior;
    destination: SettingSource;
    /** Human-readable label for the suggestion */
    label?: string;
}
export interface ToolPermissionResult {
    behavior: RuleBehavior;
    /** reviewable 仅委托本次安全确认；forced 保留必须审批，ordinary 保留原授权记忆语义。 */
    askKind?: 'ordinary' | 'reviewable' | 'forced';
    message?: string;
    decisionReason?: DecisionReason;
    /** Updated input (if modified by permission check) */
    updatedInput?: unknown;
    suggestions?: RuleSuggestion[];
}
export type PermissionUpdate = PermissionSetModeUpdate | PermissionAddRulesUpdate | PermissionReplaceRulesUpdate | PermissionRemoveRulesUpdate | PermissionAddDirectoriesUpdate | PermissionRemoveDirectoriesUpdate;
export interface PermissionSetModeUpdate {
    type: 'setMode';
    mode: PermissionMode;
    destination: SettingSource;
}
export interface PermissionAddRulesUpdate {
    type: 'addRules';
    rules: RuleValue[];
    behavior: RuleBehavior;
    destination: SettingSource;
}
export interface PermissionReplaceRulesUpdate {
    type: 'replaceRules';
    rules: RuleValue[];
    behavior: RuleBehavior;
    destination: SettingSource;
}
export interface PermissionRemoveRulesUpdate {
    type: 'removeRules';
    rules: RuleValue[];
    behavior: RuleBehavior;
    destination: SettingSource;
}
export interface PermissionAddDirectoriesUpdate {
    type: 'addDirectories';
    directories: string[];
    destination: SettingSource;
}
export interface PermissionRemoveDirectoriesUpdate {
    type: 'removeDirectories';
    directories: string[];
    destination: SettingSource;
}
/** Session permission state; the mode is stored separately by the runtime. */
export interface ToolPermissionContext {
    additionalWorkingDirectories: Map<string, {
        path: string;
        source: SettingSource;
    }>;
    /** Session rules are stored under the 'session' key. */
    allowRules: Record<SettingSource, string[]>;
    denyRules: Record<SettingSource, string[]>;
    askRules: Record<SettingSource, string[]>;
    /** Can be disabled by policy or project settings. */
    isBypassPermissionsModeAvailable: boolean;
    /** When true, "ask" becomes "deny" (e.g., async agents, SDK mode). */
    shouldAvoidPermissionPrompts: boolean;
}
//# sourceMappingURL=tool-permission-types.d.ts.map