/**
 * Control Signal Protocol
 *
 * 定义 SDK 与 agent-cli 之间的控制信号通信协议。
 * 类型定义参考：claude-agent-sdk/src/protocol/control-types.ts
 */
import type { SdkCapabilities } from '../../vendor/cbc-shared/node/index.js';
import type { Command, ReasoningEffortLevel } from '@genie/product';
import type { ThoughtLevel } from '../session/model-change-reconcile';
export declare const ControlSignalHandler: unique symbol;
export declare const ControlSignalSubtypeHandler: unique symbol;
export declare const HOOK_EVENTS: readonly ["PreToolUse", "PostToolUse", "PostToolUseFailure", "Notification", "UserPromptSubmit", "SessionStart", "SessionEnd", "Stop", "SubagentStart", "SubagentStop", "PreCompact", "PostCompact", "PermissionRequest", "WorktreeCreate", "WorktreeRemove"];
export type HookEvent = (typeof HOOK_EVENTS)[number];
export interface BaseHookInput {
    hook_event_name: HookEvent;
    session_id: string;
    transcript_path: string;
    cwd: string;
    permission_mode?: string;
    tool_use_id?: string;
    /** CLI hook 聚合的 hookSpecificOutput 透传（来自 settings.json 中配置的 local hooks） */
    hook_specific_output?: Record<string, unknown>;
}
export type PreToolUseHookInput = BaseHookInput & {
    hook_event_name: 'PreToolUse';
    tool_name: string;
    tool_input: Record<string, unknown>;
};
export type PostToolUseHookInput = BaseHookInput & {
    hook_event_name: 'PostToolUse';
    tool_name: string;
    tool_input: Record<string, unknown>;
    tool_response: unknown;
};
export type PostToolUseFailureHookInput = BaseHookInput & {
    hook_event_name: 'PostToolUseFailure';
    tool_name: string;
    tool_input: Record<string, unknown>;
    error: string;
    is_interrupt: boolean;
};
export type NotificationHookInput = BaseHookInput & {
    hook_event_name: 'Notification';
    message: string;
    notification_type: 'permission_prompt' | 'idle_prompt' | 'auth_success' | 'elicitation_dialog';
    title?: string;
};
export type UserPromptSubmitHookInput = BaseHookInput & {
    hook_event_name: 'UserPromptSubmit';
    prompt: string;
};
export type SessionStartHookInput = BaseHookInput & {
    hook_event_name: 'SessionStart';
    source: 'startup' | 'resume' | 'clear' | 'compact';
};
export type SessionEndHookInput = BaseHookInput & {
    hook_event_name: 'SessionEnd';
    reason: 'clear' | 'logout' | 'prompt_input_exit' | 'bypass_permissions_disabled' | 'other';
};
export type StopHookInput = BaseHookInput & {
    hook_event_name: 'Stop';
    stop_hook_active: boolean;
};
export type SubagentStartHookInput = BaseHookInput & {
    hook_event_name: 'SubagentStart';
    agent_id: string;
    agent_type: string;
};
export type SubagentStopHookInput = BaseHookInput & {
    hook_event_name: 'SubagentStop';
    stop_hook_active: boolean;
    agent_id?: string;
    agent_transcript_path?: string;
};
export type PreCompactHookInput = BaseHookInput & {
    hook_event_name: 'PreCompact';
    trigger: 'manual' | 'auto';
    custom_instructions: string | null;
};
export type PostCompactHookInput = BaseHookInput & {
    hook_event_name: 'PostCompact';
    trigger: 'manual' | 'auto';
    compact_summary?: string;
};
export type PermissionRequestHookInput = BaseHookInput & {
    hook_event_name: 'PermissionRequest';
    tool_name: string;
    tool_input: Record<string, unknown>;
    permission_suggestions?: unknown[];
};
export type WorktreeCreateHookInput = BaseHookInput & {
    hook_event_name: 'WorktreeCreate';
    name: string;
};
export type WorktreeRemoveHookInput = BaseHookInput & {
    hook_event_name: 'WorktreeRemove';
    worktree_path: string;
};
export type HookInput = PreToolUseHookInput | PostToolUseHookInput | PostToolUseFailureHookInput | NotificationHookInput | UserPromptSubmitHookInput | SessionStartHookInput | SessionEndHookInput | StopHookInput | SubagentStartHookInput | SubagentStopHookInput | PreCompactHookInput | PostCompactHookInput | PermissionRequestHookInput | WorktreeCreateHookInput | WorktreeRemoveHookInput;
export interface HookSpecificOutput {
    hookEventName: HookEvent;
    permissionDecision?: 'allow' | 'deny' | 'ask';
    permissionDecisionReason?: string;
    updatedInput?: Record<string, unknown>;
    additionalContext?: string;
}
export interface HookOutput {
    continue?: boolean;
    decision?: 'approve' | 'block';
    reason?: string;
    stopReason?: string;
    suppressOutput?: boolean;
    systemMessage?: string;
    hookSpecificOutput?: HookSpecificOutput;
}
export type { SdkCapabilities } from '../../vendor/cbc-shared/node/index.js';
/**
 * 初始化请求
 */
export interface ControlInitializeRequest {
    subtype: 'initialize';
    hooks?: Partial<Record<string, ControlHookCallbackMatcher[]>>;
    sdkMcpServers?: string[];
    jsonSchema?: Record<string, unknown>;
    systemPrompt?: string;
    appendSystemPrompt?: string;
    agents?: Record<string, unknown>;
    /** 预定义环境（用于认证时切换环境） */
    environment?: AuthEnvironment;
    /** 自定义 endpoint URL（用于 selfhosted 认证） */
    endpoint?: string;
    /** SDK capabilities declaration */
    capabilities?: SdkCapabilities;
    /** 是否有 prompt 将在初始化后发送（用于 resume 时决定是否回放历史） */
    hasPrompt?: boolean;
}
/**
 * 初始化响应
 */
export interface ControlInitializeResponse {
    commands: unknown[];
    output_style: string;
    available_output_styles: string[];
    models: unknown[];
    account: unknown;
    /** The current model ID resolved by CLI */
    currentModelId?: string;
}
/**
 * 中断请求
 */
export interface ControlInterruptRequest {
    subtype: 'interrupt';
    session_id?: string;
    reason?: string;
}
/**
 * 中断响应
 */
export interface ControlInterruptResponse {
    session_id: string;
    interrupted: boolean;
    reason: string;
}
/**
 * Steer 请求（stream-json 控制信号，对齐 ACP `session/steer` #85193 / #96889）
 */
export interface ControlSteerRequest {
    subtype: 'steer';
    session_id?: string;
    content_blocks: unknown[];
    /** 乐观并发校验，对齐 ACP 的 expectedRequestId */
    expected_request_id?: string;
}
/**
 * Steer 响应
 */
export interface ControlSteerResponse {
    session_id: string;
    steered: boolean;
    reason?: 'idle' | 'stale';
}
/**
 * 工具权限请求
 */
export interface ControlPermissionRequest {
    subtype: 'can_use_tool';
    tool_name: string;
    input: Record<string, unknown>;
    permission_suggestions?: unknown[];
    blocked_path?: string;
    decision_reason?: string;
    tool_use_id: string;
    agent_id?: string;
}
/**
 * 工具权限响应
 */
export interface ControlPermissionResponse {
    allowed: boolean;
    reason?: string;
    tool_use_id: string;
    /** 如果为 true，表示应该中断会话而不是让 agent 继续 */
    interrupt?: boolean;
}
/**
 * Elicitation 创建请求（CLI → SDK，参数命名与 ACP `elicitation/create` 的
 * CreateElicitationRequest 完全对齐，camelCase 原样透传）。SDK 用户处理后
 * 以 ACP 扁平 CreateElicitationResponse 形状回包：{ action, content?, _meta? }。
 */
export interface ControlElicitationCreateRequest {
    subtype: 'elicitation_create';
    /** ACP SessionId（子代理收口到父会话） */
    sessionId: string;
    /** 关联的工具调用（SDK ≥0.25 官方 SessionScope 字段） */
    toolCallId?: string;
    /** 交互模式（当前仅 'form'） */
    mode?: string;
    /** 给用户的说明文案 */
    message?: string;
    /** form 模式的受限 JSON Schema（与 MCP elicitation 一致） */
    requestedSchema?: Record<string, unknown>;
    /** 扩展载荷（codebuddy.ai 卡片渲染数据等） */
    _meta?: Record<string, unknown>;
}
/**
 * Elicitation 响应（SDK → CLI，ACP 官方扁平形状）。
 */
export interface ControlElicitationCreateResponse {
    action: 'accept' | 'decline' | 'cancel';
    content?: Record<string, unknown>;
    _meta?: Record<string, unknown>;
}
/**
 * Elicitation 收口通知数据（CLI → SDK，经 control_notification 'elicitation'
 * 频道下发，对齐 ACP `elicitation/complete` 通知语义——fire-and-forget,
 * 老 SDK 对未知频道静默丢弃，天然向后兼容）。
 */
export interface ElicitationCompleteNotificationData {
    /** 对应 create 请求 _meta['codebuddy.ai'].elicitationId */
    elicitationId: string;
    /** 扩展载荷（codebuddy.ai：sessionId 路由冗余、weixinpayResult 终态等） */
    _meta?: Record<string, unknown>;
}
/**
 * 审批收口通知（CLI → SDK，经 control_notification 'permission' 频道下发）。
 *
 * 在此之前 stream-json 上**没有**任何撤卡手段：一条 `can_use_tool` 发出去后，
 * 若被 CLI 侧的其它路径决策掉，SDK 端已经渲染的卡片不会收到任何通知，会一直
 * 挂着（`cancelRequest` 只 reject 本地 Deferred，一个字节都不出 stdout）。
 *
 * 语义对齐 ACP 的 `permissionResolved` 广播而不是 elicitation 的纯作废：带上
 * `decision` 才能让端侧把卡片翻成正确终态。只是「消失」会让用户以为自己的
 * 操作丢了。
 *
 * 载体选 control_notification 而不是协议里那个从未被发送过的
 * `control_cancel_request`：前者两端都已实证兼容（agent-sdk-js 有 dispatch
 * 分支，sandbox-proxy 对未知 channel 静默丢弃），后者两端都不认。
 */
export interface PermissionResolvedNotificationData {
    /** 对应 can_use_tool 请求的 tool_use_id。 */
    toolCallId: string;
    /** 对应 control_request 的 request_id，便于端侧按任一维度对齐。 */
    requestId: string;
    decision: 'allow' | 'deny';
    /** 谁做的决定，用于展示「已由外部调用方回答」之类的文案。 */
    resolvedBy: string;
}
/**
 * 设置权限模式请求
 */
export interface ControlSetPermissionModeRequest {
    subtype: 'set_permission_mode';
    session_id?: string;
    mode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto';
}
/**
 * 设置权限模式响应
 */
export interface ControlSetPermissionModeResponse {
    session_id: string;
    mode: string;
    /** 之前的模式（如果 session 还未初始化则为 undefined） */
    previous_mode?: string;
    /** Plan 文件路径（仅当切换到 plan 模式时返回） */
    plan_file_path?: string;
}
/**
 * 获取可用权限模式请求
 */
export interface ControlGetAvailableModesRequest {
    subtype: 'get_available_modes';
    session_id?: string;
}
/**
 * 获取可用权限模式响应
 */
export interface ControlGetAvailableModesResponse {
    availableModes: Array<{
        id: string;
        name: string;
        description: string;
    }>;
}
/**
 * 获取可用模型请求
 */
export interface ControlGetAvailableModelsRequest {
    subtype: 'get_available_models';
}
/**
 * 原始模型配置（完整的 LanguageModel 信息）
 */
export interface RawLanguageModel {
    id: string;
    name?: string;
    vendor?: string;
    version?: string;
    family?: string;
    maxInputTokens?: number;
    maxOutputTokens?: number;
    description?: string;
    descriptionEn?: string;
    descriptionZh?: string;
    configurable?: boolean;
    configured?: boolean;
    supportsExtra?: boolean;
    supportsToolCall?: boolean;
    supportsImages?: boolean;
    supportsReasoning?: boolean;
    onlyReasoning?: boolean;
    maxAllowedSize?: number;
    tags?: string[];
    disabledMultimodal?: boolean;
    credits?: string;
    reasoning?: {
        effort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
        /** 默认推理强度（优先级高于 effort）；Issue #12554 */
        defaultEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
        /** UI 可展示的强度档位；Issue #12554 */
        supportedEfforts?: ReadonlyArray<'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'>;
        summary?: 'auto' | 'concise' | 'detailed';
        /** 是否提供"关闭思考"入口，默认 true；Issue #12554 */
        canDisableThinking?: boolean;
    };
    maxImageCount?: number;
    isDefault?: boolean;
    temperature?: number;
    iconUrl?: string;
    modelType?: 'enterprise' | 'built-in';
    trustLevel?: 'unverified' | 'custom' | 'certified';
    disabled?: boolean;
    disabledReason?: string;
    disabledAction?: {
        type: 'link' | 'applyGroup';
        text?: string;
        link?: string;
    };
    relatedModels?: Partial<Record<'lite' | 'reasoning' | 'vision' | 'longContext' | 'subagent', string>>;
}
/**
 * 获取可用模型响应
 */
export interface ControlGetAvailableModelsResponse {
    /** 简化的模型列表（向后兼容） */
    availableModels: Array<{
        modelId: string;
        name: string;
        description?: string;
    }>;
    /** 完整的原始模型配置列表 */
    rawModels: RawLanguageModel[];
}
/**
 * 设置模型请求
 */
export interface ControlSetModelRequest {
    subtype: 'set_model';
    session_id?: string;
    model?: string;
}
/**
 * 设置模型响应
 */
export interface ControlSetModelResponse {
    session_id: string;
    model: string;
    previous_model?: string;
    /**
     * Session context budget after the switch (Issue #145200). Present only when
     * the session is live. `override` is the session choice (`null` = none, the
     * session follows the model default); `effective` is the budget the next
     * request uses, absent when the model is not in the local catalog.
     */
    context_window?: {
        override: number | null;
        effective?: number;
    };
    /**
     * Session thinking state after the switch (Issue #145200). Present only when
     * the session is live. `override` is the session `thoughtLevel` choice
     * (`null` = none); `effective` reflects the on/off and effort the next
     * request is expected to use, for logging and diagnosis.
     */
    thinking?: {
        override: ThoughtLevel | null;
        effective: {
            enabled: boolean;
            reasoning_effort?: ReasoningEffortLevel;
        };
    };
}
/**
 * 设置配置请求
 */
export interface ControlSetConfigRequest {
    subtype: 'set_config';
    session_id?: string;
    config: Record<string, unknown>;
}
/**
 * 设置配置响应
 */
export interface ControlSetConfigResponse {
    session_id: string;
    updated: Record<string, unknown>;
    errors?: Record<string, string>;
}
/**
 * 设置最大思考 token 请求
 */
export interface ControlSetMaxThinkingTokensRequest {
    subtype: 'set_max_thinking_tokens';
    session_id?: string;
    max_thinking_tokens: number | null;
}
/**
 * MCP 状态请求
 */
export interface ControlMcpStatusRequest {
    subtype: 'mcp_status';
}
/**
 * 回滚文件请求
 *
 * 对齐 Claude Code v2.1.88 `control_request { subtype: 'rewind_files' }` schema。
 * 参考：`~/workspace/claude-code-source-code/src/entrypoints/sdk/controlSchemas.ts:308`
 *
 * 语义与 Claude 完全一致：**只回退磁盘文件，不动对话历史**。若上游需要
 * 文件 + 对话历史一起回退，使用 subtype='rewind'（ControlRewindRequest）。
 */
export interface ControlRewindFilesRequest {
    subtype: 'rewind_files';
    user_message_id: string;
    /** 仅预览：不真正修改磁盘，仅返回 filesChanged/insertions/deletions 统计 */
    dry_run?: boolean;
}
/**
 * 回滚文件响应
 *
 * 对齐 Claude schema 的 `{ canRewind, error?, filesChanged?, insertions?, deletions? }`。
 * 严格保持字段名与语义——保证 CloudAgent等上游 SDK 对 rewind_files 的解析
 * 与 Claude Code 一致。
 */
export interface ControlRewindFilesResponse {
    canRewind: boolean;
    error?: string;
    filesChanged?: string[];
    insertions?: number;
    deletions?: number;
}
/**
 * 回滚请求（可选择回退文件 / 对话历史 / 两者）
 *
 * cbc 扩展 subtype（Claude 只有 rewind_files 且只回文件）。通过 scope 选择范围：
 *   - 'CodeAndConversation'（默认）：文件 + 对话历史一起回退（真实上游 CloudAgent 用法）
 *   - 'Conversation'：仅回退对话历史，保留磁盘文件
 *   - 'Code'：仅回退磁盘文件（等价rewind_files，但走本响应结构）
 *
 * 关键语义（应上游要求，仅在 scope 含 Code+Conversation 时相关）：
 * **文件回退失败不阻塞历史回退**。handler 先尽力回退文件（失败仅记录到
 * fileRewindError），再回退对话历史（必须成功）。因此即使工作区文件被
 * 占用/权限不足，对话上下文仍能正确回到目标点。
 */
export interface ControlRewindRequest {
    subtype: 'rewind';
    user_message_id: string;
    /**
     * 回退范围，默认 'CodeAndConversation'（文件+历史）。
     * 'Conversation' 仅历史；'Code' 仅文件。
     */
    scope?: 'Code' | 'Conversation' | 'CodeAndConversation';
    /** 仅预览：不真正修改磁盘、不截断历史，仅返回将要回退的文件差异统计 */
    dry_run?: boolean;
}
/**
 * 回滚响应（scope 可含文件 / 对话历史）
 *
 * - canRewind=true 且无 fileRewindError → 请求范围内全部成功回退
 * - canRewind=true 且有 fileRewindError → **部分成功**：历史已回退，但文件回退
 *   失败（上游据此提示用户手动处理文件，但对话上下文已正确回到目标点）
 * - canRewind=false → 前置校验失败（目标非 user 消息 / 无 checkpoint / 无 session），
 *   文件与历史都未改动
 *
 * historyRewound 反映本次是否回退了对话历史（scope 含 Conversation 时为 true）。
 */
export interface ControlRewindResponse {
    canRewind: boolean;
    error?: string;
    /** 已回退的文件列表（回退成功或dry-run 预览） */
    filesChanged?: string[];
    insertions?: number;
    deletions?: number;
    /** 对话历史是否已回退 */
    historyRewound?: boolean;
    /**
     * 文件回退阶段的错误（若有）。存在此字段但 canRewind=true 即「部分成功」：
     * 历史已回退，文件回退失败——不视为整体失败。
     */
    fileRewindError?: string;
}
/**
 * Hook 回调匹配器
 */
export interface ControlHookCallbackMatcher {
    matcher?: string;
    hookCallbackIds: string[];
    /** Timeout in seconds for all hooks in this matcher */
    timeout?: number;
}
/**
 * Hook 回调请求 - CLI 发送给 SDK，请求执行 hook callback
 */
export interface ControlHookCallbackRequest {
    subtype: 'hook_callback';
    callback_id: string;
    input: HookInput;
    tool_use_id?: string;
}
/**
 * Hook 回调响应 - SDK 返回给 CLI
 */
export type ControlHookCallbackResponse = HookOutput;
/**
 * MCP 消息请求
 */
export interface ControlMcpMessageRequest {
    subtype: 'mcp_message';
    server_name: string;
    message: unknown;
}
/**
 * MCP 消息响应
 */
export interface ControlMcpMessageResponse {
    server_name: string;
    mcp_response: unknown;
}
/**
 * MCP 设置服务器请求
 *
 * @deprecated 未实现且 payload 语义（`servers: Record<string, unknown>`）与 initialize
 * 里的 `sdkMcpServers: string[]` 不一致。新代码请使用 `ControlUpdateSdkConfigRequest`
 * （`update_sdk_config` subtype），可同时更新 sdkMcpServers 与 hooks，语义与 initialize
 * 对齐。保留声明避免破坏可能的外部引用，实际未注册对应 handler。
 */
export interface ControlMcpSetServersRequest {
    subtype: 'mcp_set_servers';
    servers: Record<string, unknown>;
}
/**
 * MCP 设置服务器响应
 *
 * @deprecated 见 {@link ControlMcpSetServersRequest}。
 */
export interface ControlMcpSetServersResponse {
    added: string[];
    removed: string[];
    errors: Record<string, string>;
}
/**
 * 会话中动态更新 SDK 侧运行时配置的请求。
 *
 * cbc stdio 常驻模式下 `initialize` 是一次性握手（第二次调用会被拒），因此需要一条
 * 独立的 control_request 通道让 daemon 在同一进程内改写 sdk MCP server 集合与 hooks
 * 而不必断开重连。字段全部可选：只传 hooks 则不动 MCP，只传 sdkMcpServers 则不动
 * hooks，两个都传就都改。传入即为全量替换语义（与 initialize 对齐）。
 */
export interface ControlUpdateSdkConfigRequest {
    subtype: 'update_sdk_config';
    /**
     * SDK scope 下期望激活的 MCP server 名字全量列表。当前不在里面的会被 remove，
     * 新出现的会被 add；语义与 initialize 里的 `sdkMcpServers` 一致。
     */
    sdkMcpServers?: string[];
    /**
     * hooks 全量替换。语义与 initialize 里的 `hooks` 一致——为 `{}` 或省略某事件
     * 意味着该事件的 hook 被清空。
     */
    hooks?: Partial<Record<HookEvent, ControlHookCallbackMatcher[]>>;
}
/**
 * `update_sdk_config` 响应。仅在对应字段被请求更新时才有子对象，便于调用方在只更新
 * 单一维度时省事解析。
 */
export interface ControlUpdateSdkConfigResponse {
    sdkMcpServers?: {
        added: string[];
        removed: string[];
        /** 单个 server 的 add/remove 错误信息，不阻塞其他 server 的处理。 */
        errors: Record<string, string>;
    };
    hooks?: {
        updated: true;
    };
}
/**
 * 认证状态（包含登录链接）
 * @unstable This API is experimental and may change in future versions.
 */
export interface AuthState {
    state: string;
    authUrl: string;
}
/**
 * 认证方法
 * @unstable This API is experimental and may change in future versions.
 */
export interface AuthMethod {
    id: string;
    name: string;
    description: string | null;
}
/**
 * 获取认证方法请求
 * @unstable This API is experimental and may change in future versions.
 */
export interface ControlGetAuthMethodsRequest {
    subtype: 'get_auth_methods';
}
/**
 * 获取认证方法响应
 * @unstable This API is experimental and may change in future versions.
 */
export interface ControlGetAuthMethodsResponse {
    authMethods: AuthMethod[];
}
/**
 * 预定义认证环境
 * @unstable This API is experimental and may change in future versions.
 */
export type AuthEnvironment = 'external' | 'internal' | 'ioa' | 'cloudhosted';
/**
 * 发起认证请求
 * @unstable This API is experimental and may change in future versions.
 */
export interface ControlAuthenticateRequest {
    subtype: 'authenticate';
    methodId: string;
    /** 预定义环境（与 endpoint 二选一） */
    environment?: AuthEnvironment;
    /** 自定义 endpoint URL（用于 selfhosted，与 environment 二选一） */
    endpoint?: string;
}
/**
 * 认证 URL 回调请求 - CLI 发送给 SDK，通知打开登录链接
 * @unstable This API is experimental and may change in future versions.
 */
export interface ControlAuthUrlCallbackRequest {
    subtype: 'auth_url_callback';
    authState: AuthState;
}
/**
 * 认证结果回调请求 - CLI 发送给 SDK，通知认证结果
 * @unstable This API is experimental and may change in future versions.
 */
export interface ControlAuthResultCallbackRequest {
    subtype: 'auth_result_callback';
    success: boolean;
    userinfo?: {
        userId: string;
        userName: string;
        userNickname: string;
        token: string;
        enterpriseId?: string;
        enterprise?: string;
    };
    error?: {
        type: 'timeout' | 'cancelled' | 'network_error' | 'invalid_method' | 'auth_failed';
        message: string;
    };
}
/**
 * 登出请求 - 清除缓存的认证 token
 * @unstable This API is experimental and may change in future versions.
 */
export interface ControlLogoutRequest {
    subtype: 'logout';
    /** 预定义环境（与 endpoint 二选一），不指定则清除当前环境 */
    environment?: AuthEnvironment;
    /** 自定义 endpoint URL（用于 selfhosted，与 environment 二选一） */
    endpoint?: string;
}
/**
 * 支持的订阅频道
 */
export type SubscriptionChannel = 'commands' | 'elicitation' | 'permission';
/**
 * 订阅请求
 */
export interface ControlSubscribeRequest {
    subtype: 'subscribe';
    channel: SubscriptionChannel;
}
/**
 * 订阅响应
 */
export interface ControlSubscribeResponse {
    subscribed: boolean;
    channel: SubscriptionChannel;
}
/**
 * 取消订阅请求
 */
export interface ControlUnsubscribeRequest {
    subtype: 'unsubscribe';
    channel: SubscriptionChannel;
}
/**
 * 取消订阅响应
 */
export interface ControlUnsubscribeResponse {
    unsubscribed: boolean;
    channel: SubscriptionChannel;
}
/**
 * 控制通知消息 - CLI 主动推送给 SDK
 */
export interface ControlNotificationMessage {
    type: 'control_notification';
    channel: SubscriptionChannel;
    data: unknown;
}
/**
 * Commands 频道通知数据
 * 直接使用 Command 接口，由 SDK 侧自行处理
 */
export interface CommandsNotificationData {
    commands: Command[];
    timestamp: number;
}
/**
 * 控制请求的 request 字段类型
 */
export type ControlRequestPayload = ControlInterruptRequest | ControlSteerRequest | ControlPermissionRequest | ControlElicitationCreateRequest | ControlInitializeRequest | ControlSetPermissionModeRequest | ControlGetAvailableModesRequest | ControlGetAvailableModelsRequest | ControlSetModelRequest | ControlSetConfigRequest | ControlSetMaxThinkingTokensRequest | ControlMcpStatusRequest | ControlHookCallbackRequest | ControlMcpMessageRequest | ControlRewindFilesRequest | ControlRewindRequest | ControlMcpSetServersRequest | ControlUpdateSdkConfigRequest | ControlGetAuthMethodsRequest | ControlAuthenticateRequest | ControlAuthUrlCallbackRequest | ControlAuthResultCallbackRequest | ControlLogoutRequest | ControlSubscribeRequest | ControlUnsubscribeRequest;
/**
 * 控制请求消息
 */
export interface ControlRequest {
    type: 'control_request';
    request_id: string;
    request: ControlRequestPayload;
    /** W3C propagation metadata for requests created inside an exact active turn. */
    _meta?: Record<string, unknown>;
}
/**
 * 类型化的控制请求消息（用于 handler 中缩窄类型）
 */
export type TypedControlRequest<T extends ControlRequestPayload> = Omit<ControlRequest, 'request'> & {
    request: T;
};
/**
 * 控制响应消息
 */
export interface ControlResponseMessage {
    type: 'control_response';
    response: ControlResponse | ControlErrorResponse;
}
/**
 * 成功响应
 */
export interface ControlResponse {
    subtype: 'success';
    request_id: string;
    response?: Record<string, unknown>;
}
/**
 * 错误响应
 */
export interface ControlErrorResponse {
    subtype: 'error';
    request_id: string;
    error: string;
    pending_permission_requests?: ControlRequest[];
}
export interface ControlCancelRequest {
    type: 'control_cancel_request';
    request_id: string;
}
export type StdoutMessage = ControlResponseMessage | ControlRequest | ControlCancelRequest | ControlNotificationMessage;
export type StdinMessage = ControlRequest | ControlResponseMessage;
export type ControlSignalMessage = ControlRequest | ControlResponseMessage | ControlCancelRequest;
export interface ControlSignalHandler {
    handleMessage(message: ControlSignalMessage): Promise<void>;
    cancelRequest(requestId: string): void;
    sendResponse(response: ControlResponseMessage): void;
    sendNotification(notification: ControlNotificationMessage): void;
}
/**
 * 控制请求子类型
 */
export type ControlRequestSubtype = 'initialize' | 'interrupt' | 'steer' | 'can_use_tool' | 'elicitation_create' | 'set_permission_mode' | 'get_available_modes' | 'get_available_models' | 'set_model' | 'set_config' | 'set_max_thinking_tokens' | 'mcp_status' | 'hook_callback' | 'mcp_message' | 'rewind_files' | 'rewind' | 'mcp_set_servers' | 'get_auth_methods' | 'authenticate' | 'auth_url_callback' | 'auth_result_callback' | 'logout' | 'subscribe' | 'unsubscribe';
/**
 * 控制信号子类型处理器接口（泛型版本）
 *
 * @template TRequest - 请求载荷类型
 * @template TResponse - 响应类型
 */
export interface ControlSignalSubtypeHandler<TRequest extends ControlRequestPayload = ControlRequestPayload, TResponse = Record<string, unknown>> {
    /**
     * 处理的子类型
     */
    readonly subtype: TRequest['subtype'];
    /**
     * 处理控制请求
     * @param request 类型化的控制请求
     * @param abortSignal 中止信号
     * @returns 响应数据
     */
    handle(request: TypedControlRequest<TRequest>, abortSignal: AbortSignal): Promise<TResponse>;
}
export interface ControlSignalConfig {
    requestTimeoutMs: number;
}
export declare const DEFAULT_CONTROL_SIGNAL_CONFIG: ControlSignalConfig;
export declare function isControlRequest(message: ControlSignalMessage): message is ControlRequest;
export declare function isControlResponse(message: ControlSignalMessage): message is ControlResponseMessage;
export declare function isControlCancelRequest(message: ControlSignalMessage): message is ControlCancelRequest;
export declare function isControlSignalMessage(message: unknown): message is ControlSignalMessage;
export declare const SdkPermissionClient: unique symbol;
export interface SdkPermissionClient {
    requestPermission(toolName: string, input: Record<string, unknown>, toolUseId: string, options?: PermissionRequestOptions): Promise<PermissionResult>;
    handleResponse(requestId: string, response: ControlResponse | ControlErrorResponse): void;
    cancelRequest(requestId: string): void;
    cancelAllPending(reason: string): void;
    /**
     * 撤掉一条待决审批，并告诉端侧把卡片收起来。
     *
     * 按 `toolUseId` 而不是内部 `perm_xxx` 反查：调用方（双通道仲裁）只认识
     * toolCallId，没必要把内部 requestId 透出去。找不到就是无操作——对端早
     * 回过或从未发出，都不该报错。
     */
    cancelByToolUseId(toolUseId: string, resolvedBy: string, decision?: 'allow' | 'deny'): void;
}
export interface PermissionRequestOptions {
    timeout?: number;
    agentId?: string;
    permissionSuggestions?: unknown[];
    blockedPath?: string;
    decisionReason?: string;
}
export interface PermissionResult {
    allowed: boolean;
    reason?: string;
    /** 如果为 true，表示应该中断会话而不是让 agent 继续 */
    interrupt?: boolean;
    /** Updated tool input from SDK (e.g., AskUserQuestion answers) */
    updatedInput?: Record<string, unknown>;
}
export declare const SdkElicitationClient: unique symbol;
/**
 * CLI → SDK 的 elicitation 通道（stream-json 会话）。与 ACP 的
 * createElicitation / completeElicitation 一一对应：
 * create 经 control_request('elicitation_create') 往返；complete 经
 * control_notification('elicitation' 频道) fire-and-forget 下发。
 * 调用方必须先确认 SDK 已声明 capabilities.elicitation（见 SdkCapabilities）。
 */
export interface SdkElicitationClient {
    /**
     * 下发 elicitation 并等待用户响应（无默认超时——交互型请求由调用方
     * 自己的 race/abort 收口；signal 中止时挂起项被拒绝并清理）。
     */
    createElicitation(params: Omit<ControlElicitationCreateRequest, 'subtype'>, options?: {
        signal?: AbortSignal;
    }): Promise<ControlElicitationCreateResponse>;
    /** 收口通知（对齐 ACP elicitation/complete，无响应）。 */
    completeElicitation(data: ElicitationCompleteNotificationData): void;
    handleResponse(requestId: string, response: ControlResponse | ControlErrorResponse): void;
    cancelAllPending(reason: string): void;
}
export declare const SdkHooksManager: unique symbol;
export interface SdkHooksManager {
    setHooks(hooks: Partial<Record<HookEvent, ControlHookCallbackMatcher[]>>): void;
    clearHooks(): void;
    hasHooks(event: HookEvent): boolean;
    getHooks(event: HookEvent): ControlHookCallbackMatcher[];
    invokeCallback(callbackId: string, input: HookInput, toolUseId?: string, timeout?: number): Promise<HookOutput>;
    handleResponse(requestId: string, response: ControlResponse | ControlErrorResponse): void;
    /** Set SDK capabilities from initialize request */
    setCapabilities(capabilities: SdkCapabilities | undefined): void;
    /** Get SDK capabilities */
    getCapabilities(): SdkCapabilities | undefined;
}
export interface HookExecutionResult {
    shouldContinue: boolean;
    stopReason?: string;
    permissionDecision?: 'allow' | 'deny' | 'ask';
    permissionDecisionReason?: string;
    updatedInput?: Record<string, unknown>;
    systemMessages: string[];
    additionalContext: string[];
    suppressOutput: boolean;
}
/**
 * SDK 端通过 initialize control_request 传入的 agent 定义形状。
 * 与 CLI flag --agents 共用，定义见 product/agent-conversion-utils.ts。
 */
export interface SdkInitializeAgentDefinition {
    description: string;
    prompt: string;
    tools?: string[];
    disallowedTools?: string[];
    model?: string;
}
export interface SdkInitializeState {
    systemPrompt?: string;
    appendSystemPrompt?: string;
    agents?: Record<string, SdkInitializeAgentDefinition>;
}
export declare const SdkInitializeStateService: unique symbol;
/**
 * 持有 SDK 通过 initialize control_request 传入的 agent / system prompt 配置。
 *
 * InitializeHandler 收到请求后写入此 service，配套的 SdkInitializeProductProvider
 * 在产品配置 sync 时读出，转换成 product agents / 默认 agent override。
 *
 * Dedup 语义: ``set`` / ``clear`` 返回布尔表示是否需要触发 sync。`set` 比较的是
 * "上次**成功** sync 过的 fingerprint" —— 失败的 sync 不会推进它，所以同一 payload
 * 重试会再次触发 sync。sync 成功后调用 ``markSynced()`` 推进 fingerprint。
 */
export interface SdkInitializeStateService {
    set(state: SdkInitializeState): boolean;
    markSynced(): void;
    clear(): boolean;
    get(): SdkInitializeState;
}
