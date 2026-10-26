/**
 * Per-session canUseTool binding —— 交互回程「回调面」的席位
 * （server `QueryOptions.canUseTool`；设计见 docs/cloud-native/elicitation-design.md）。
 *
 * 类型逐字对齐 @anthropic-ai/claude-agent-sdk@0.3.235 `sdk.d.ts`（vendored
 * declarations 判例，同 agent-sdk-types.ts / SessionStore）：CanUseTool 的
 * 基础参数和 PermissionUpdate 复用 SDK 原形；setMode 的模式集合随运行时扩展，
 * 包括 CodeBuddy 的 fullAccess。origin、metadata 等可选字段是宿主桥接扩展，
 * 不改变未使用这些扩展的调用方。
 *
 * 「server 武装、bin 休眠」：bin 从不绑定，resolver 恒 undefined，全部现行
 * 审批通道（TUI / ACP / stream-json SDK / bare -p deny）逐字不变。
 * 解析判据同 permission 播种（resolveSandbox 同款）：显式 session 优先，
 * 缺席落 root scope——子代理审批链带 child session 进来，绑定挂在主会话。
 */
import type { ContentBlock } from '@genie/agent-client-protocol';
import type { Session, SubagentEventReference } from './session-protocol';
export type PermissionBehavior = 'allow' | 'deny' | 'ask';
export type PermissionUpdateDestination = 'userSettings' | 'projectSettings' | 'localSettings' | 'session';
export type PermissionDecisionClassification = 'user_temporary' | 'user_permanent' | 'user_reject';
export interface PermissionRuleValue {
    toolName: string;
    ruleContent?: string;
}
export type PermissionUpdate = {
    type: 'addRules';
    rules: PermissionRuleValue[];
    behavior: PermissionBehavior;
    destination: PermissionUpdateDestination;
} | {
    type: 'replaceRules';
    rules: PermissionRuleValue[];
    behavior: PermissionBehavior;
    destination: PermissionUpdateDestination;
} | {
    type: 'removeRules';
    rules: PermissionRuleValue[];
    behavior: PermissionBehavior;
    destination: PermissionUpdateDestination;
} | {
    type: 'setMode';
    mode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto' | 'fullAccess';
    destination: PermissionUpdateDestination;
} | {
    type: 'addDirectories';
    directories: string[];
    destination: PermissionUpdateDestination;
} | {
    type: 'removeDirectories';
    directories: string[];
    destination: PermissionUpdateDestination;
};
export type PermissionResult = {
    behavior: 'allow';
    updatedInput?: Record<string, unknown>;
    updatedPermissions?: PermissionUpdate[];
    toolUseID?: string;
    decisionClassification?: PermissionDecisionClassification;
    /** Optional host response metadata; interpreted only by the requesting tool. */
    metadata?: Record<string, unknown>;
} | {
    behavior: 'deny';
    message: string;
    interrupt?: boolean;
    toolUseID?: string;
    decisionClassification?: PermissionDecisionClassification;
};
export interface CanUseToolOptions {
    /** Execution identity, independent of the permission RPC requestId. */
    origin?: {
        requestId?: string;
        rootRequestId?: string;
        subagent?: SubagentEventReference;
    };
    /** Signaled if the operation should be aborted. */
    signal: AbortSignal;
    /** 「总是允许」类 UI 可回填为 PermissionResult.updatedPermissions。 */
    suggestions?: PermissionUpdate[];
    /** 触发审批的路径（如 Bash 越界访问），如适用。 */
    blockedPath?: string;
    /** 本次审批被触发的原因说明。 */
    decisionReason?: string;
    /** 桥端渲染好的完整提示句（优先于宿主自行拼接）。 */
    title?: string;
    /** 工具动作的短名词短语（按钮/紧凑 UI 用）。 */
    displayName?: string;
    /** 桥端渲染的副标题说明。 */
    description?: string;
    /** Display-only ACP tool content for this approval; never added to model input. */
    content?: ContentBlock[];
    /** Tool-provided display/context metadata for host permission UIs. Not an authorization grant. */
    metadata?: Record<string, unknown>;
    /** 本次工具调用在 assistant 消息内的唯一 id。 */
    toolUseID: string;
    /** 子代理上下文中触发时，子代理的 id。 */
    agentID?: string;
    /**
     * control_request 信封的 request_id。带外响应（未来的 respond verb /
     * B transport）必须回显此值；回调面直接 return 即可，无需关心。
     */
    requestId: string;
    /** permissions.ask 规则强制弹问时携带（宿主自动裁决策略应视为人为意图）。 */
    matchedAskRule?: {
        source: string;
        toolName: string;
        ruleContent?: string;
    };
}
/**
 * Claude Agent SDK 同形权限回调。返回 `null` 仅当调用方已带外发送响应
 * （SDK 契约原文；回调面首版无带外通道——null 会让该工具审批永久悬挂，
 * 仅 interrupt/abort 可解，内核会告警）。
 */
export type CanUseTool = (toolName: string, input: Record<string, unknown>, options: CanUseToolOptions) => Promise<PermissionResult | null>;
/**
 * 谁占着这个席位。审批只认回调本身，但「这个回调背后是不是还有别的人能答」
 * 取决于占位者：真正的宿主（server `QueryOptions.canUseTool`）是唯一 UI，
 * 而 A2A inbound 之外还并行着一条 stream-json 通道。双通道判据靠它区分，
 * 不能只看「席位非空」。
 */
export type CanUseToolOwner = 'host' | 'a2a';
/** Bind (or clear) at activation. Mirrors the sandbox/settings mount seam. */
export declare function setSessionCanUseTool(session: Session, callback: CanUseTool | undefined, owner?: CanUseToolOwner): void;
/** The binding for an explicitly known session. */
export declare function getSessionCanUseTool(session: Session | undefined): CanUseTool | undefined;
/**
 * 显式优先、root 回退（resolveSandbox 判例）：子代理 child 无绑定时落到
 * 主会话；bin 无 root scope 且无绑定，恒 undefined。
 */
export declare function resolveCanUseTool(session: Session | undefined): CanUseTool | undefined;
/**
 * `resolveCanUseTool` 选中的那个绑定的占位者。回退顺序必须与它逐字一致，
 * 否则会出现「回调取自 child、owner 取自 root」的错配。
 */
export declare function resolveCanUseToolOwner(session: Session | undefined): CanUseToolOwner | undefined;
/** The host's answer, or why there is none: `signal` aborted, or the time ran out. */
export type HostConfirmation = PermissionResult | {
    readonly behavior: 'cancelled' | 'timeout';
};
/**
 * 向宿主确认 Agent 自己发起的询问（敏感信息、工具循环等），CE 把它们作为 ACP
 * 权限请求发出。宿主收到的 signal 中止即撤回卡片：`signal` 中止，或超过
 * `timeoutMs`。宿主回 null 时询问保持到其中之一发生。
 */
export declare function requestHostConfirmation(canUseTool: CanUseTool, toolName: string, input: Record<string, unknown>, { signal, timeoutMs, ...options }: Omit<CanUseToolOptions, 'signal'> & {
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
}): Promise<HostConfirmation>;
//# sourceMappingURL=can-use-tool.d.ts.map