import { Event } from '@celljs/core';
import { PermissionMode, type ReasoningEffortLevel } from '../../vendor/cbc-shared/node/index.js';
import { MarketplaceConfig } from '@genie/product';
import { type SandboxConfig } from '../bash-sandbox/bash-sandbox-protocol';
export { PermissionMode, type ReasoningEffortLevel } from '../../vendor/cbc-shared/node/index.js';
export type ThemeName = 'light' | 'dark' | 'light-colorblind' | 'dark-colorblind' | 'light-ansi' | 'dark-ansi';
/**
 * 单个 skill 的可见性覆盖状态（对齐 Claude Code 的 `skillOverrides`）。
 *
 * - `on`：不覆盖，回退 SKILL.md frontmatter 现状（缺省项等同于 `on`）。
 * - `name-only`：模型上下文里只列出名称、不带描述；`/` 菜单仍可见。
 * - `user-invocable-only`：对模型隐藏（不列出）；`/` 菜单仍可见、用户与模型按名调用仍放行。
 * - `off`：对模型与 `/` 菜单都隐藏，且按名调用返回禁用报错。
 *
 * plugin skill 不受 `skillOverrides` 影响（改由 `/plugin` 管理）。
 */
export type SkillOverrideState = 'on' | 'name-only' | 'user-invocable-only' | 'off';
/** `skillOverrides` 设置：按 skill 名称索引的可见性覆盖表。 */
export type SkillOverridesSetting = Record<string, SkillOverrideState>;
/** Security Center Tool execution policy. Missing fields are fail-open. */
export interface ToolControlSettings {
    version: 1;
    disabledToolIds?: string[];
    disabledMcpServerIds?: string[];
    disabledMcpToolIds?: string[];
    customMcpEnabled?: boolean;
}
export interface SettingsCacheEntry {
    settings: Settings;
    expires: number;
}
export interface SettingsUpdateResult {
    /** updater 已在有效 settings 上成功完成；no-op 也为 true。 */
    applied: boolean;
    /** 更新实际写入磁盘。 */
    changed: boolean;
}
/**
 * Decoded snapshot of the persisted user settings layer.
 *
 * `config` contains only values explicitly stored in the user layer; defaults
 * are deliberately not materialized here. `version` fingerprints the exact
 * persisted bytes (including the missing-file state) and is suitable for CAS.
 */
export interface UserSettingsLayerSnapshot {
    config: Record<string, unknown>;
    filePath: string;
    version: string;
}
export interface UserSettingsLayerMutationResult extends UserSettingsLayerSnapshot {
    changed: boolean;
}
export declare class UserSettingsVersionConflictError extends Error {
    readonly expectedVersion: string;
    readonly actualVersion: string;
    constructor(expectedVersion: string, actualVersion: string);
}
export declare class UserSettingsInvalidFileError extends Error {
    readonly filePath: string;
    constructor(filePath: string, options?: ErrorOptions);
}
export declare class UserSettingsWriteError extends Error {
    readonly filePath: string;
    constructor(filePath: string);
}
export declare const SETTINGS_MIDDLEWARE_PRIORITY: number;
export declare const SettingsManager: unique symbol;
export declare const SETTINGS_FILENAME = "settings.json";
export declare const SETTINGS_LOCAL_FILENAME = "settings.local.json";
export declare enum SettingsScope {
    USER = "user",
    PROJECT = "project",
    PROJECT_LOCAL = "project-local",
    CLI = "cli"
}
export declare const GLOBAL_SETTING_KEYS: string[];
export declare const PROJECT_SETTING_KEYS: string[];
export declare const ENV_KEY_CODEBUDDY_INTERNET_ENVIRONMENT = "CODEBUDDY_INTERNET_ENVIRONMENT";
export declare const ENV_KEY_CODEBUDDY_INTERNET_ENVIROMENT = "CODEBUDDY_INTERNET_ENVIROMENT";
/** 设置未写 envRouteMode 时的路由模式；嵌入方按进程给出（取值同 EnvRouteMode）。 */
export declare const ENV_KEY_CODEBUDDY_ENV_ROUTE_MODE = "CODEBUDDY_ENV_ROUTE_MODE";
/** Keep the live context percentage visible in the TUI input status area. */
export declare const ENV_KEY_CODEBUDDY_SHOW_CONTEXT_USAGE = "CODEBUDDY_SHOW_CONTEXT_USAGE";
export declare const ENV_PRODUCT_CLI_ACCOUNT_TYPE = "ENV_PRODUCT_CLI_ACCOUNT_TYPE";
export declare const ENV_KEY_CODEBUDDY_AUTH_TOKEN = "CODEBUDDY_AUTH_TOKEN";
export declare const ENV_KEY_CODEBUDDY_CUSTOM_HEADERS = "CODEBUDDY_CUSTOM_HEADERS";
export declare const ENV_KEY_CODEBUDDY_API_KEY = "CODEBUDDY_API_KEY";
export declare const ENV_KEY_CODEBUDDY_API_KEY_DISABLED = "CODEBUDDY_API_KEY_DISABLED";
export declare const ENV_KEY_CODEBUDDY_API_KEY_HELPER_DISABLED = "CODEBUDDY_API_KEY_HELPER_DISABLED";
export declare const ENV_KEY_CODEBUDDY_BASE_URL = "CODEBUDDY_BASE_URL";
export declare const ENV_KEY_CODEBUDDY_CODE_API_KEY_HELPER_TTL_MS = "CODEBUDDY_CODE_API_KEY_HELPER_TTL_MS";
export declare const ENV_KEY_CODEBUDDY_TEXT_TO_IMAGE_MODEL = "CODEBUDDY_TEXT_TO_IMAGE_MODEL";
export declare const ENV_KEY_CODEBUDDY_IMAGE_TO_IMAGE_MODEL = "CODEBUDDY_IMAGE_TO_IMAGE_MODEL";
export declare const ENV_KEY_CODEBUDDY_TEXT_TO_VIDEO_MODEL = "CODEBUDDY_TEXT_TO_VIDEO_MODEL";
export declare const ENV_KEY_CODEBUDDY_IMAGE_TO_VIDEO_MODEL = "CODEBUDDY_IMAGE_TO_VIDEO_MODEL";
export declare const ENV_KEY_CODEBUDDY_IMAGE_GEN_ENABLED = "CODEBUDDY_IMAGE_GEN_ENABLED";
export declare const ENV_KEY_CODEBUDDY_IMAGE_EDIT_ENABLED = "CODEBUDDY_IMAGE_EDIT_ENABLED";
export declare const ENV_KEY_CODEBUDDY_VIDEO_GEN_ENABLED = "CODEBUDDY_VIDEO_GEN_ENABLED";
export declare const ENV_KEY_CODEBUDDY_AUDIO_TRANSCRIBE_ENABLED = "CODEBUDDY_AUDIO_TRANSCRIBE_ENABLED";
/** Decision 整体请求体（input + questions 合计）字节上限覆盖。 */
export declare const ENV_KEY_CODEBUDDY_DECISION_MAX_PAYLOAD_BYTES = "CODEBUDDY_DECISION_MAX_PAYLOAD_BYTES";
/** Decision 单个 input 字节上限覆盖。 */
export declare const ENV_KEY_CODEBUDDY_DECISION_MAX_INPUT_BYTES = "CODEBUDDY_DECISION_MAX_INPUT_BYTES";
/** Decision 单次请求问题数上限覆盖。 */
export declare const ENV_KEY_CODEBUDDY_DECISION_MAX_QUESTIONS = "CODEBUDDY_DECISION_MAX_QUESTIONS";
export declare const ENV_KEY_CODEBUDDY_TOOL_SEARCH_RERANK_ENABLED = "CODEBUDDY_TOOL_SEARCH_RERANK_ENABLED";
/** 参与精排的候选数上限覆盖；超出部分保持 MiniSearch 原序拼在后面。 */
export declare const ENV_KEY_CODEBUDDY_TOOL_SEARCH_RERANK_MAX_CANDIDATES = "CODEBUDDY_TOOL_SEARCH_RERANK_MAX_CANDIDATES";
/** 单次精排的时间预算（ms）覆盖；超时即放弃精排、回落召回顺序。 */
export declare const ENV_KEY_CODEBUDDY_TOOL_SEARCH_RERANK_BUDGET_MS = "CODEBUDDY_TOOL_SEARCH_RERANK_BUDGET_MS";
export declare const ENV_KEY_CODEBUDDY_HIGH_CREDIT_APPROVAL_ENABLED = "CODEBUDDY_HIGH_CREDIT_APPROVAL_ENABLED";
export declare const ENV_KEY_CODEBUDDY_ARTIFACT_ENABLED = "CODEBUDDY_ARTIFACT_ENABLED";
/** @deprecated 兼容保留，请改用 CODEBUDDY_ARTIFACT_ENABLED（新名优先，旧名兜底）。 */
export declare const ENV_KEY_CODEBUDDY_SHARE_LINK_ENABLED = "CODEBUDDY_SHARE_LINK_ENABLED";
export declare const ENV_KEY_CODEBUDDY_COMPUTER_USE_ENABLED = "CODEBUDDY_COMPUTER_USE_ENABLED";
export declare const ENV_KEY_CODEBUDDY_PUSH_NOTIFICATION_ENABLED = "CODEBUDDY_PUSH_NOTIFICATION_ENABLED";
export declare const ENV_KEY_CODEBUDDY_WAIT_FOR_MCP_SERVERS_ENABLED = "CODEBUDDY_WAIT_FOR_MCP_SERVERS_ENABLED";
export declare const ENV_KEY_CODEBUDDY_REPORT_FINDINGS_ENABLED = "CODEBUDDY_REPORT_FINDINGS_ENABLED";
export declare const ENV_KEY_CODEBUDDY_MONITOR_ENABLED = "CODEBUDDY_MONITOR_ENABLED";
export declare const ENV_KEY_CODEBUDDY_DISABLE_HOT_RELOAD = "CODEBUDDY_DISABLE_HOT_RELOAD";
/** Turns sensitive data protection off for the process without touching the shared settings.json (wb rollout). */
export declare const ENV_KEY_CODEBUDDY_DISABLE_SENSITIVE_PROTECTION = "CODEBUDDY_DISABLE_SENSITIVE_PROTECTION";
/**
 * `--setting-sources` 的进程级注册通道（同一套语法：'user,project,local' /
 * 'none'）。供无 argv 形态（@tencent-ai/agent-cli/server 库模式）使用：served
 * 入口在 bundle 装载期即注册 'none'（窗口闭合——boot 期读绝不落盘档），
 * `start({ settingSources })` 以宿主选择覆写，宿主打开的档从挂载的 fs 来
 * （settings 读写走 dataFs）。argv 显式指定时仍优先；bin 从不注册，行为
 * 逐字原样。（原 env 孪生 CODEBUDDY_SETTING_SOURCES 已随 start options
 * 归位撤除——typed 通道取代进程 env。）
 */
export { getProcessSettingSources, setProcessSettingSources } from './setting-sources-state';
/**
 * Sync twin of the settings-sources adjudication, for pre-DI / sync readers
 * that cannot consult CliSettingSourcesProvider (argv wins over env, same as
 * the provider; absent → everything allowed, the bin default). Only the disk
 * scopes participate; any other scope resolves true.
 */
export declare function isSettingScopeAllowedSync(scope: SettingsScope, argv?: readonly string[]): boolean;
export declare const ENV_KEY_CODEBUDDY_SKIP_BUILTIN_MARKETPLACE = "CODEBUDDY_SKIP_BUILTIN_MARKETPLACE";
export declare const ENV_KEY_CODEBUDDY_DEFER_TOOL_LOADING = "CODEBUDDY_DEFER_TOOL_LOADING";
export declare const ENV_KEY_CODEBUDDY_SHOW_ALL_DEFERRED_TOOLS = "CODEBUDDY_SHOW_ALL_DEFERRED_TOOLS";
export declare const ENV_KEY_CODEBUDDY_SKIP_INTERNAL_HEADERS = "CODEBUDDY_SKIP_INTERNAL_HEADERS";
/**
 * issue #53191：关闭「1 小时 prompt cache」（body 根 `cache_retention: 'long'`）的 kill switch。
 *
 * **默认关闭（即默认启用 1h 缓存）**——自有/官方模型的请求默认带 `cache_retention: 'long'`，
 * 让 Claude 系上游把 prompt cache TTL 从 5 分钟拉长到 1 小时，显著降低积分消耗。
 * 设为 truthy 时退回服务端默认档位 `short`（仍有 5 分钟缓存，不是完全禁用缓存）。
 * truthy 判定走 `BooleanUtils.isTruthy`：`1` / `true` / `yes` / `on`，大小写不敏感且先 trim。
 *
 * 语义对齐 claude-code 的 `DISABLE_PROMPT_CACHING*` 系列（那边是 message 级
 * `cache_control.ttl`，我们是 body 根级 `cache_retention`，档位枚举见服务端
 * `services/pkg/enum/cache_retention.go`：disabled | short | long）。
 */
export declare const ENV_KEY_CODEBUDDY_DISABLE_PROMPT_CACHING_1H = "CODEBUDDY_DISABLE_PROMPT_CACHING_1H";
/**
 * 逗号分隔、大小写不敏感的前缀白名单，决定哪些客户端透传的自定义 header 允许转发到
 * model gateway（配合 `_meta['codebuddy.ai'].customPassthroughHeaders`）。由部署方（sandbox-proxy
 * 拉起 codebuddy 子进程时）设置。**默认空 ⇒ 功能关闭**（不透传任何 header），作为安全 kill-switch。
 */
export declare const ENV_KEY_CODEBUDDY_PASSTHROUGH_HEADER_PREFIXES = "CODEBUDDY_PASSTHROUGH_HEADER_PREFIXES";
export declare const ENV_KEY_CODEBUDDY_GATEWAY_FORCE_TUNNEL = "CODEBUDDY_GATEWAY_FORCE_TUNNEL";
export declare const ENV_KEY_CODEBUDDY_MEMORY_ENABLED = "CODEBUDDY_MEMORY_ENABLED";
export declare const ENV_KEY_CODEBUDDY_TEAM_MEMORY_ENABLED = "CODEBUDDY_TEAM_MEMORY_ENABLED";
export declare const ENV_KEY_CODEBUDDY_USER_ID = "CODEBUDDY_USER_ID";
export declare const ENV_KEY_CODEBUDDY_DISABLE_AUTO_MEMORY = "CODEBUDDY_DISABLE_AUTO_MEMORY";
export declare const ENV_KEY_CODEBUDDY_TYPED_MEMORY_ENABLED = "CODEBUDDY_TYPED_MEMORY_ENABLED";
export declare const ENV_KEY_CODEBUDDY_DISABLE_PARENT_MEMORY = "CODEBUDDY_DISABLE_PARENT_MEMORY";
export declare const ENV_KEY_CODEBUDDY_TOOL_SEARCH_MAX_OUTPUT_CHARS = "CODEBUDDY_TOOL_SEARCH_MAX_OUTPUT_CHARS";
export declare const ENV_KEY_CODEBUDDY_TOOL_SEARCH_MIN_SCORE_RATIO = "CODEBUDDY_TOOL_SEARCH_MIN_SCORE_RATIO";
export declare const ENV_KEY_CODEBUDDY_TOOL_SEARCH_CAMEL_SPLIT = "CODEBUDDY_TOOL_SEARCH_CAMEL_SPLIT";
export { ENV_KEY_CODEBUDDY_TASK_LIST_ID } from '../../vendor/cbc-core/node/session/session-constants.js';
export declare const ENV_KEY_CODEBUDDY_DISABLE_CRON = "CODEBUDDY_DISABLE_CRON";
export declare const ENV_KEY_CODEBUDDY_DISABLE_WORKFLOWS = "CODEBUDDY_DISABLE_WORKFLOWS";
export declare const ENV_KEY_CODEBUDDY_MODEL = "CODEBUDDY_MODEL";
export declare const ENV_KEY_CODEBUDDY_SMALL_FAST_MODEL = "CODEBUDDY_SMALL_FAST_MODEL";
export declare const ENV_KEY_CODEBUDDY_BIG_SLOW_MODEL = "CODEBUDDY_BIG_SLOW_MODEL";
export declare const ENV_KEY_CODEBUDDY_CODE_SUBAGENT_MODEL = "CODEBUDDY_CODE_SUBAGENT_MODEL";
export declare const ENV_KEY_CODEBUDDY_DISABLE_BUILTIN_MODELS = "CODEBUDDY_DISABLE_BUILTIN_MODELS";
export declare const ENV_KEY_MAX_THINKING_TOKENS = "MAX_THINKING_TOKENS";
export declare const DEFAULT_API_KEY_HELPER_TTL_MS = 300000;
export declare const IOA_DEFAULT_DOMAIN = "tencent.sso.copilot.tencent.com";
export declare const IOA_DEFAULT_ENTERPRISE_ID = "etahzsqej0n4";
export declare const IOA_DEFAULT_STAGING_DOMAIN = "tencent.sso.copilot-staging.tencent.com";
export declare const IOA_DEFAULT_STAGING_ENTERPRISE_ID = "esoikz80kd8g";
export interface Settings {
    /** 默认模型 */
    model?: string;
    /** 文生图模型 */
    textToImageModel?: string;
    /** 图生图模型 */
    imageToImageModel?: string;
    /** 文生视频模型 */
    textToVideoModel?: string;
    /** 图生视频模型 */
    imageToVideoModel?: string;
    /** 本地保留聊天记录的时间（默认值：30 天） */
    cleanupPeriodDays?: number;
    /** 将应用于每个会话的环境变量 */
    env?: {
        [key: string]: string;
    };
    /** 是否在 git 提交和拉取请求中包含 co-authored-by 默认值：true */
    includeCoAuthoredBy?: boolean;
    /** 权限 */
    permissions?: Permissions;
    /** 安全中心的 Tool 执行管控，仅使用用户级配置。 */
    toolControl?: ToolControlSettings;
    /** auto 模式分类器的自然语言策略规则（environment/allow/soft_deny/hard_deny） */
    autoMode?: AutoModeSettings;
    /** 配置自定义命令，使其在工具执行之前或之后运行 */
    hooks?: Hooks;
    /** 配置自定义状态行以显示上下文 */
    statusLine?: StatusLine;
    /** 自动批准项目 .mcp.json 文件中定义的所有 MCP 服务器 */
    enableAllProjectMcpServers?: boolean;
    /** .mcp.json 文件中需要批准的特定 MCP 服务器列表 */
    enabledMcpjsonServers?: string[];
    /** .mcp.json 文件中要拒绝的特定 MCP 服务器列表 */
    disabledMcpjsonServers?: string[];
    /** 关闭后台会话与 agent view（`codebuddy agents` 将拒绝打开） */
    disableAgentView?: boolean;
    /**
     * 前台会话空输入框按 ← 是否转后台并打开 agent view。
     * 仅显式 `false` 关闭；未设置视为开启（对齐 Claude `leftArrowOpensAgents`）。
     */
    leftArrowOpensAgents?: boolean;
    /** 开启自动压缩 */
    autoCompactEnabled?: boolean;
    /**
     * 自动压缩计算的上下文窗口基准值（token 数），默认（未设置）跟随模型窗口。
     * 触发点解析见 `resolveCompactTriggerAt`；环境变量 `CODEBUDDY_AUTO_COMPACT_WINDOW` 优先。
     *
     * 与 ACP `context_window` 档位（会话上下文窗口选择）正交：后者决定模型有效预算，
     * 本项仅在其基础上进一步收窄压缩触发点，不影响状态行 usage 分母。
     */
    autoCompactWindow?: number;
    /** CLI 内存中的上下文预算默认值（tokens），供 set_config 在首轮前配置。 */
    contextWindow?: number;
    /** 自动更新设置 */
    autoUpdates?: boolean;
    /** daemon 设置 */
    daemon?: DaemonSettings;
    /** 获取认证 key 的脚本，例如 /bin/generate_temp_api_key.sh */
    apiKeyHelper?: string;
    /** 路由模式 */
    envRouteMode?: EnvRouteMode;
    /** 主题 */
    theme?: ThemeName;
    /** 自定义 endpoint */
    endpoint?: string;
    /** 企业域 endpoint */
    enterpriseEndpoint?: string;
    /** 是否信任所有目录 */
    trustAll?: boolean;
    /** 信任的目录列表 */
    trustedDirectories?: string[];
    /** 是否始终启用思考模式 */
    alwaysThinkingEnabled?: boolean;
    /** 是否忽略 git 仓库的 .gitignore 文件 */
    ignoreGitIgnore?: boolean;
    /**
     * 禁用 Unreal Engine 项目自动排除（默认 false，即自动排除）
     * cbc 检测到 cwd 顶层存在 *.uproject 时，自动在 Grep/Glob 工具里追加
     * UE 编译产物目录排除（Intermediate/DerivedDataCache/Saved/Binaries/Build/.vs）。
     * 设为 true 可关闭该行为。
     */
    disableUEAutoExclude?: boolean;
    /**
     * 禁用 Dynamic Workflow 能力(默认 false)。设为 true 时:
     *   - LLM 看不到 Workflow 工具
     *   - `ultracode` 关键字不再注入 reminder
     *   - `/effort ultracode` 档位被拒绝
     * 也可以用环境变量 `CODEBUDDY_DISABLE_WORKFLOWS=1` 在启动时强制禁用。
     * 对齐 Claude Code 同名能力。
     */
    disableWorkflows?: boolean;
    /** 启用的插件 */
    enabledPlugins?: Record<string, boolean>;
    /** 团队市场配置 */
    extraKnownMarketplaces?: MarketplaceConfig;
    /** 是否展示tokens计数器 */
    showTokensCounter?: boolean;
    /** 是否始终展示当前会话的上下文窗口使用率 */
    showContextUsage?: boolean;
    /**
     * 是否在每轮回复结束后展示本轮耗时（`✔ Worked for 1m 31s`）。默认 true。
     *
     * 关闭后不再写入该记录项，历史里也就不会留下这一行；被中断或以报错收场的
     * 回合本来就不展示，不受此开关影响。
     */
    showTurnDuration?: boolean;
    /** 沙箱配置 */
    sandbox?: SandboxConfig;
    /** 安全中心敏感信息保护配置 */
    sensitiveProtection?: {
        enabled?: boolean;
    };
    /** 启用通过粘贴处理剪贴板中的图片/文件 */
    enablePasteImageFromClipboard?: boolean;
    /** 输出样式配置 */
    outputStyle?: string;
    /** Vim 编辑器模式配置 */
    vim?: {
        /** 是否启用 Vim 模式 */
        enabled?: boolean;
    };
    /** 首选通知渠道 */
    preferredNotifChannel?: NotifChannel;
    /** 启用终端进度条 (OSC 9;4) */
    enableTerminalProgressBar?: boolean;
    /** 启用文件回退功能 */
    fileCheckpointingEnabled?: boolean;
    /** 启用 prompt 建议功能 */
    promptSuggestionEnabled?: boolean;
    /** Defer tool loading - 是否全局启用 MCP 工具延迟加载 */
    deferToolLoading?: boolean;
    /** 首选响应语言，如 "简体中文"、"English" 等 */
    language?: string;
    /** 记忆功能配置 */
    memory?: MemoryConfig;
    /** 对话历史中保留图片 base64 的最近轮数（默认: 2） */
    imageHistoryRetainRounds?: number;
    /** Worktree 功能配置 */
    worktree?: WorktreeConfig;
    /** Reasoning effort 级别配置，为空时使用产品配置默认值 */
    reasoningEffort?: ReasoningEffortLevel;
    /** 企业微信集成配置 */
    wecom?: WecomConfig;
    /** 是否默认折叠 Hook 输出（默认: false，即展示输出） */
    hookOutputCollapsed?: boolean;
    /** Gateway 远程访问配置 */
    gateway?: GatewaySettings;
    /** 主线程使用的 agent 名称（内置或自定义 agent），应用该 agent 的 system prompt、工具限制和模型 */
    agent?: string;
    /** codebuddy.* 命名空间设置（主 Agent 选择等，与既有 settings.agent 语义隔离） */
    codebuddy?: CodebuddySettings;
    /** 是否启用 Channel 功能（默认: true） */
    channelsEnabled?: boolean;
    /** daemon 启动时是否自动连接已保存凭证的 channel（默认: true） */
    daemonAutoConnectChannels?: boolean;
    /** 插件配置存储（非敏感选项） */
    pluginConfigs?: Record<string, PluginConfigEntry>;
    /**
     * 是否允许来自用户本地 `.codebuddy/agents|skills/*.md` **以及插件市场** 的
     * frontmatter hooks 被注册执行。默认 `false`（对齐 Claude Code 的
     * admin-trusted 语义）—— 插件市场 agent/skill 在 cbc 里会被打上
     * `CUSTOM_AGENT_TAG`，同样被视为不可信来源，避免通过分发渠道静默启动
     * shell 命令。只有 product 内置 agent/skill（无 `CUSTOM_AGENT_TAG`）是
     * admin-trusted，不受此开关影响。
     */
    allowUntrustedFrontmatterHooks?: boolean;
    /**
     * 「帮助优化模型」开关（PRD #44599）。
     *
     * - `{ enabled: true }`：用户同意优化 → 发送 `X-Private-Data: false`
     * - `{ enabled: false }`：用户拒绝 → 发送 `X-Private-Data: true`
     * - `undefined`：用户从未设置，由客户端产品默认值和企业账号策略决定
     *
     * 使用对象包装避免 CellJS 框架序列化 falsy 值为空 body。
     * 该 header 仅对内置模型生效，自定义模型（第三方 endpoint）不发送。
     */
    enableModelOptimization?: {
        enabled: boolean;
    };
    /**
     * 按内置子 Agent 粒度指定模型（Issue #66763，能力 A）。
     *
     * 结构对齐 GitHub Copilot CLI 的 `subagents.agents.<name>` 形态，便于后续扩展
     * （如按子 Agent 追加 effort/context 维度）。当前仅开放 `model` 字段：
     * - `agents` 的 key = 子 Agent 名称（与 product.json `agents[].name` 对齐，如 "Explore"）
     * - `agents[name].model` = 模型 ID / 别名 / 变体（"lite" | "reasoning" ...） / "inherit" | "default"
     *
     * 未配置或 `model` 为 "inherit" / "default" 时回落默认编排（内置声明 → 继承主对话模型）。
     * 环境变量 `CODEBUDDY_CODE_SUBAGENT_MODEL` 仍为最高优先级、对所有子 Agent 一刀切，
     * 设置时本配置暂不生效。项目级按 agent key 递归合并覆盖全局同名 Agent
     * （见 settings-manager 的 `mergeBySubKeySettings` + 递归 `deepMerge`）。
     */
    subagents?: SubagentsSetting;
    /**
     * 通用场景变体 → 模型 的映射（Issue #66763，能力 B）。
     *
     * - key   = 变体名（本期开放 "lite" | "reasoning"）
     * - value = 模型 ID / 别名
     *
     * 未配置则回落到既有变体解析链（模型级 relatedModels → 全局 defaultRelatedModels →
     * 主模型兜底）。对应的环境变量（lite→`CODEBUDDY_SMALL_FAST_MODEL`、
     * reasoning→`CODEBUDDY_BIG_SLOW_MODEL`）仍为最高优先级、按变体独立生效。
     * 项目级按 key 覆盖全局同名变体（浅合并）。
     */
    variantModels?: Partial<Record<'lite' | 'reasoning', string>>;
    /**
     * 按 skill 名称索引的可见性覆盖表（对齐 Claude Code 的 `skillOverrides`）。
     *
     * 每个值为 `on` | `name-only` | `user-invocable-only` | `off` 四态之一；
     * 未列出的 skill 视为 `on`（回退 SKILL.md frontmatter）。plugin skill 不受影响。
     *
     * 跨 scope 按 skill key 合并（见 settings-manager 的 `mergeBySubKeySettings`），
     * `/skills` 菜单的编辑写入 PROJECT_LOCAL（`.codebuddy/settings.local.json`）。
     */
    skillOverrides?: SkillOverridesSetting;
}
/**
 * 单个内置子 Agent 的配置（Issue #66763，能力 A）。当前仅 `model` 一维，
 * 结构对齐 GitHub Copilot CLI 的 `subagents.agents.<name>`，预留后续扩展位
 * （如 effortLevel / contextTier）。
 */
export interface SubagentSettingConfig {
    /** 该子 Agent 使用的模型：ID / 别名 / 变体（'lite'|'reasoning'）/ 'inherit'|'default'。 */
    model?: string;
}
/**
 * 子 Agent 配置容器（Issue #66763，能力 A）。`agents` 按子 Agent 名称索引，
 * 跨 scope 由 settings-manager 递归 `deepMerge` 按 agent key 合并（项目级覆盖全局同名项）。
 */
export interface SubagentsSetting {
    agents?: Record<string, SubagentSettingConfig>;
}
/**
 * codebuddy.* 命名空间设置（与既有 `settings.agent` 语义隔离）。
 *
 * 主 Agent 四种模式（唯一配置面，见 main-agent-policy.ts）：
 * - `enabled`：总闸。缺省开；显式 false 关。env `CODEBUDDY_MAIN_AGENT_ENABLED` 可覆盖。
 * - `allowUnopted`：未声明 mainAgentSupport 的 ACP 宿主（WorkBuddy）是否也走
 *   standing 解析。缺省关。env `CODEBUDDY_MAIN_AGENT_ALLOW_UNOPTED` 可覆盖。
 * - `default`：能力生效时的新会话默认主 agent（设置页「设为默认」）。
 * - `lastUsed`：上次 chip / 新建智能体选择；不覆盖 `default`。
 */
export interface CodebuddySettings {
    /** 用户显式连接远程控制后，允许 daemon 重启恢复；不保存认证令牌。 */
    remoteControl?: {
        autoConnect?: boolean;
    };
    /** Web UI custom apps/skins only; never opts WorkBuddy, IDE or SDK into authoring. */
    mods?: {
        enabled?: boolean;
        /** User-approved browser source hash per installed name@marketplace. Approval never enables a plugin. */
        clientApprovals?: Record<string, string>;
        /** Host-derived index identity, atomically bound to clientApprovals. Never a client-supplied asset grant. */
        clientResourceSnapshots?: Record<string, {
            root: string;
            sourceHash: string;
            indexHash: string;
            format?: 1 | 2;
        }>;
    };
    mainAgent?: {
        enabled?: boolean;
        allowUnopted?: boolean;
        default?: string;
        lastUsed?: string;
    };
    /**
     * Agent Home（仅 agent-cli Web）：侧栏以持久 Agent 目录为主键，Job 降级为
     * Agent 名下的 Run。
     *
     * Web UI 只有通讯录一个工作台；TUI / WorkBuddy / IDE 无首访行为：
     * - `orchestration`：用户侧自治开关（设置页「允许 Agent 自主组队」），缺省关。
     *   关闭 = 自治工具不可用、不再唤醒/注入，通讯录与已有数据照常显示。
     *   CLI Web UI 首次在浏览器打开（非 `?embedded=agent`）且从未配置过时自动写一次 true；
     *   旧版选过「单干」的浏览器一次性迁移为 false。
     * - `enabled`：运维回滚键，显式 false 时 Web 中列回落 Job 列表、目录 API 返回 enabled:false。
     */
    agentHome?: {
        enabled?: boolean;
        orchestration?: boolean;
        /** 自动投递到主 Agent 的任务完成回执。默认 all。 */
        taskReceipts?: 'all' | 'batch' | 'off';
    };
    /**
     * Web 输入框在 agent 忙碌时的发送方式（仅 agent-cli Web；不进 WorkBuddy overlay）。
     * `queue`：入队，回合结束后再发；`immediate`（默认）：插入当前回合（对齐 DSH Enter / steer）。
     */
    composer?: {
        busySendMode?: 'queue' | 'immediate';
    };
}
/**
 * 插件配置条目
 */
export interface PluginConfigEntry {
    /** 用户配置选项值 */
    options?: Record<string, string | boolean | number>;
}
/**
 * 企业微信集成配置
 */
export interface WecomConfig {
    /** 是否启用企业微信集成 (默认: false) */
    enabled?: boolean;
    /** 是否使用摘要模式，AI 自动对回复内容生成摘要避免长消息刷屏 (默认: true) */
    useSummary?: boolean;
}
/** daemon 设置（user 作用域） */
export interface DaemonSettings {
    /** 阻止系统自动休眠但允许熄屏（默认: true）；运行中修改即时生效，ALLOW_SLEEP 环境变量优先。 */
    preventSleep?: boolean;
    /** 新版本就绪后是否在空闲时自动重启 daemon（默认: true）。环境变量 CODEBUDDY_DAEMON_AUTO_RESTART_DISABLED=1 强制关闭 */
    autoRestartOnUpdate?: boolean;
}
/**
 * Gateway 远程访问配置
 * 参考 code-server 的认证设计:
 *   - auth: 'password' 启用密码认证, 'none' 不认证
 *   - password: 为空时首次启动自动生成并写回 settings.json
 *   - 环境变量 CODEBUDDY_GATEWAY_AUTH / CODEBUDDY_GATEWAY_PASSWORD 优先级更高
 */
export interface GatewaySettings {
    /**
     * 认证模式。未设置时由启动入口决定：`--serve` 为 `'password'`
     * （secure-by-default，issue #78178），daemon 为 `'none'`。
     * 显式设为 `'none'` 可关闭 `--serve` 的默认认证（CI / 隔离环境用）。
     */
    auth?: 'password' | 'none';
    /** 密码 (明文), 为空时首次启动自动生成 */
    password?: string;
    /** CORS 允许的额外来源列表 */
    corsOrigins?: string[];
    /** ACP 最大并发连接数 (默认: 5)，环境变量 CODEBUDDY_ACP_MAX_CONNECTIONS 优先 */
    maxConnections?: number;
    /** ACP Session Token 有效期 (毫秒, 默认: 86400000 即 24 小时)，环境变量 CODEBUDDY_ACP_TOKEN_TTL_MS 优先 */
    tokenTtlMs?: number;
    /**
     * /api/v1/runs 任务执行超时时间（毫秒，默认: 1800000 即 30 分钟）。
     * 超时后 Gateway 会返回 `{code:'EXECUTION_ERROR', message:'Task timed out after Xmin'}` 并中止等待。
     * HTTP 请求头 `X-Codebuddy-Run-Timeout`（单位毫秒）优先级更高，可针对单次请求覆盖。
     * 设为 0 或负数关闭超时保护（不建议，长任务未结束会一直占用 SSE 长连接）。
     */
    runTimeoutMs?: number;
}
/**
 * Worktree 功能配置
 */
export interface WorktreeConfig {
    /** 从主仓库符号链接到 worktree 的目录列表 (如 node_modules, .next, .cache) */
    symlinkDirectories?: string[];
    /**
     * 后台会话的编辑隔离模式。
     * 默认 worktree：后台会话首次写文件前自动移入 .codebuddy/worktrees/ 下的
     * git worktree；设为 none 则直接编辑工作副本（对齐 Claude 的
     * worktree.bgIsolation 设置）。
     */
    bgIsolation?: 'none' | 'worktree';
}
/**
 * Memory 功能配置
 */
export interface MemoryConfig {
    /** 是否启用 Auto Memory (默认: true) */
    autoMemoryEnabled?: boolean;
    /** 是否启用 Typed Memory — 4 种类型 (user/feedback/project/reference) + YAML frontmatter (默认: true) */
    typedMemory?: boolean;
    /** 是否启用 AI 相关性选择 (默认: true) */
    relevanceSelection?: boolean;
    /** 是否启用后台记忆提取 (默认: false，需要显式开启以避免额外 API 成本) */
    memoryExtraction?: boolean;
    /** 是否越过启动目录向上递归查找项目指令文件 CODEBUDDY.md/AGENTS.md (默认: true，false 时只加载启动目录本身) */
    parentDiscovery?: boolean;
    /** 团队记忆配置 */
    teamMemory?: {
        /** 是否启用团队记忆 (默认: false) */
        enabled?: boolean;
        /** 团队用户 ID */
        userId?: string;
    };
}
/**
 * 通知渠道选项
 */
export type NotifChannel = 'Auto' | 'iTerm2 (OSC 9)' | 'Terminal Bell (\\a)' | 'iTerm2 w/ Bell' | 'Kitty (OSC 99)' | 'Ghostty (OSC 777)' | 'Disabled';
export interface Permissions {
    /** 允许使用工具的权限规则数组 */
    allow?: string[];
    /** 工具使用询问权限规则数组 */
    ask?: string[];
    /** 用于拒绝工具使用的权限规则数组。使用此方法还可以将敏感文件排除在 CodeBuddy 访问范围之外 */
    deny?: string[];
    /** 可以访问的其他工作目录 */
    additionalDirectories?: string[];
    /** 默认权限模式 */
    defaultMode?: PermissionMode;
    /** 设置为 "disable" 可防止激活 bypassPermissions 模式 */
    disableBypassPermissionsMode?: string;
    /**
     * Override the default permission mode for subagents/teammates.
     * When set, ALL subagents inherit this mode instead of the main session's mode.
     * The Agent tool's `mode` parameter still takes precedence over this setting.
     * Example: "bypassPermissions" to auto-approve all subagent tool calls.
     */
    subagentPermissionMode?: PermissionMode;
    /**
     * Set to "disable" to prevent activating `auto` permission mode.
     * When disabled, `--permission-mode auto` and `defaultMode: auto` fall back to default.
     */
    disableAutoMode?: string;
}
/**
 * Natural-language policy rules consumed by the auto mode classifier.
 * Mirrors Claude Code's auto-mode config (environment / allow / soft_deny / hard_deny).
 * Each array element is a free-text rule line; `$defaults` expands built-in defaults.
 */
export interface AutoModeSettings {
    environment?: string[];
    allow?: string[];
    soft_deny?: string[];
    hard_deny?: string[];
}
/**
 * Hook configuration interface
 * Compatible with Claude Code hooks specification
 */
export interface HookConfig {
    /**
     * Regular expression to match tool names or event criteria
     *
     * Optional for events that don't require matching:
     * - UserPromptSubmit, Notification, Stop, SubagentStop: matcher is not used
     * - SessionStart: matches against 'source' field (startup|resume|clear|compact)
     * - SessionEnd: matches against 'reason' field (clear|logout|prompt_input_exit|other)
     * - PreCompact: matches against 'trigger' field (manual|auto)
     * - PreToolUse, PostToolUse: matches against tool_name
     */
    matcher?: string;
    /** List of hooks to execute when matcher matches */
    hooks: Array<{
        /**
         * Hook type:
         * - 'command': Execute shell command
         * - 'prompt': Use LLM to evaluate (Prompt Hook)
         */
        type: 'command' | 'prompt';
        /** Shell command to execute (for type: 'command') */
        command?: string;
        /**
         * LLM prompt template (for type: 'prompt')
         * Can include $ARGUMENTS placeholder for hook input data
         */
        prompt?: string;
        /** Optional model override (for type: 'prompt') */
        model?: string;
        /** Optional timeout in seconds */
        timeout?: number;
    }>;
}
/**
 * Hooks configuration for different lifecycle events
 *
 * Each event can have multiple hook configurations with matchers
 * that determine when the hooks should be triggered
 */
export interface Hooks {
    /** Hooks triggered before a tool is executed */
    PreToolUse?: HookConfig[];
    /** Hooks triggered after a tool completes successfully */
    PostToolUse?: HookConfig[];
    /** Hooks triggered for permission requests or notifications */
    Notification?: HookConfig[];
    /** Hooks triggered when user submits a prompt */
    UserPromptSubmit?: HookConfig[];
    /** Hooks triggered when main agent finishes responding */
    Stop?: HookConfig[];
    /** Hooks triggered when subagent finishes responding */
    SubagentStop?: HookConfig[];
    /** Hooks triggered before context compaction */
    PreCompact?: HookConfig[];
    /** Hooks triggered when starting or resuming a session */
    SessionStart?: HookConfig[];
    /** Hooks triggered when session terminates */
    SessionEnd?: HookConfig[];
    /** Hooks triggered when a worktree is being created */
    WorktreeCreate?: HookConfig[];
    /** Hooks triggered when a worktree is being removed */
    WorktreeRemove?: HookConfig[];
    /** Hooks triggered after a tool fails or is interrupted */
    PostToolUseFailure?: HookConfig[];
    /** Hooks triggered before a subagent starts running */
    SubagentStart?: HookConfig[];
    /** Hooks triggered when Stop hook execution itself fails */
    StopFailure?: HookConfig[];
    /** Hooks triggered after context compaction completes */
    PostCompact?: HookConfig[];
    /** Hooks triggered when a settings file changes */
    ConfigChange?: HookConfig[];
    /** Hooks triggered when an instruction file is loaded */
    InstructionsLoaded?: HookConfig[];
    /** Hooks triggered before a tool permission prompt is shown */
    PermissionRequest?: HookConfig[];
    /** Hooks triggered after a tool permission is denied */
    PermissionDenied?: HookConfig[];
    /** Hooks triggered before an MCP elicitation prompt */
    Elicitation?: HookConfig[];
    /** Hooks triggered after an MCP elicitation resolves */
    ElicitationResult?: HookConfig[];
    /** Hooks triggered when a task is created */
    TaskCreated?: HookConfig[];
    /** Hooks triggered when a task transitions to completed */
    TaskCompleted?: HookConfig[];
    /** Hooks triggered when a teammate becomes idle */
    TeammateIdle?: HookConfig[];
    /** Hooks triggered during startup or maintenance */
    Setup?: HookConfig[];
    /** Hooks triggered when a watched file changes */
    FileChanged?: HookConfig[];
    /** Hooks triggered when the working directory changes */
    CwdChanged?: HookConfig[];
    /** Internal-only hooks triggered when agent truly stops */
    FinalStop?: HookConfig[];
    /** Hooks triggered when a user-typed command/skill expands into a prompt (matcher on command_name) */
    UserPromptExpansion?: HookConfig[];
}
export interface StatusLine {
    /** 类型 */
    type?: string;
    /** 命令 */
    command?: string;
    /** 水平内边距（字符数），默认 0 */
    padding?: number;
}
export declare const DEFAULT_SETTINGS: Settings;
export interface SettingsManager {
    readonly onDidChange: Event<void>;
    get<K extends keyof Settings>(key: K, scope?: SettingsScope): Promise<Settings[K]>;
    set<K extends keyof Settings>(key: K, value: Settings[K], scope?: SettingsScope): Promise<void>;
    /**
     * 在跨进程原子读改写事务中更新单个设置。
     *
     * @returns applied 表示 updater 已在有效设置上完成；changed 表示实际持久化了变化。
     */
    update<K extends keyof Settings>(key: K, updater: (currentValue: Settings[K]) => Settings[K] | Promise<Settings[K]>, scope?: SettingsScope): Promise<SettingsUpdateResult>;
    /**
     * Reads one consistent, decoded snapshot of the USER layer under the same
     * cross-process credential lock used by USER writes.
     */
    readUserConfigLayer(): Promise<UserSettingsLayerSnapshot>;
    /**
     * Applies a whole USER-layer transaction under the normal SettingsManager
     * persistence path. The updater receives a detached decoded object and
     * must return the complete next user layer.
     */
    mutateUserConfigLayer(updater: (current: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>, expectedVersion?: string | null): Promise<UserSettingsLayerMutationResult>;
    remove<K extends keyof Settings>(key: K, values?: Settings[K], scope?: SettingsScope): Promise<void>;
    list(scope?: SettingsScope): Promise<Settings>;
    add<K extends keyof Settings>(key: K, values: Settings[K], scope?: SettingsScope): Promise<void>;
    /**
     * 清除指定 scope 的缓存，如不指定则清除所有缓存
     * @param scope 要清除缓存的 scope
     */
    clearCache(scope?: SettingsScope): void;
    /**
     * 外部（进程外）改动了 settings 文件后调用，用于补发 `onDidChange`。
     *
     * `onDidChange` 原本只在本进程 `set`/`update` 写盘后触发，手改配置文件的场景
     * 拿不到通知，依赖它的响应式链路（如 tool-manager 重建 <available_skills>）
     * 不会跑。由 ConfigWatchService 在监听到 settings 文件变更时调用。
     *
     * 内部按内容指纹去重：写盘路径也会更新指纹，因此本进程自己写文件引发的
     * watcher 回声不会重复 fire。内容确实没变时同样不 fire。
     */
    notifyExternalChange(): Promise<void>;
}
export declare const CONFIGURATION_ENV_ROUTE_MODE = "envRouteMode";
export declare const CONFIGURATION_ENDPOINT = "endpoint";
export declare const CONFIGURATION_ENTERPRISE_ENDPOINT = "enterpriseEndpoint";
export declare const enum EnvRouteMode {
    Production = "production",
    Canary = "canary",
    Staging = "staging",
    Custom = "custom"
}
