import { Agent, type AgentInputItem, type AgentOptions, type NonStreamRunOptions, type RunConfig, Runner, RunState, type StreamRunOptions, type Usage } from '../../../cbc-shared/node/index.js';
import { Agent as ProductAgentConfiguration, Command, LanguageModel, ModelVariantType } from '@genie/product';
import type { SecurityReviewFailureReason, SecurityReviewModelCallPayload, SecurityReviewType, W3CTraceContextMeta } from '@genie/telemetry';
import type { Session, SessionOptions } from '../session/session-protocol';
import { AgentNames } from './agent-names';
import type { AgentPurpose } from './agent-purpose-protocol';
import type { AgentRunContinuation, AgentRunOrigin } from './agent-run-scope';
import type { HumanInputSurface } from './human-input-surface';
export declare const AgentManager: symbol;
export declare const CustomAgentManager: unique symbol;
export declare const AgentFactory: unique symbol;
export declare const RunnerFactory: unique symbol;
export declare const RunnerProvider: unique symbol;
export declare const AgentService: unique symbol;
export declare const AgentRunInterceptor: unique symbol;
export declare const AgentCompletionWaiter: unique symbol;
export declare const AGENT_TAG_SUFFIX = "-agent";
export declare const DEFAULT_MAX_TURNS = 500;
/**
 * Lower bound for a sub-agent's `max_turns` (Issue #75034).
 *
 * The model (or env `CODEBUDDY_CODE_SUBAGENT_MAX_TURNS`) may request a very
 * small `max_turns` (e.g. 1). A sub-agent needs at least a few turns to think,
 * call tools and observe results across a multi-step task; a tiny cap causes
 * the sub-agent to be silently truncated mid-task. We therefore clamp any
 * positive-but-too-small requested value up to this floor so multi-step
 * sub-agent tasks are not cut off prematurely.
 */
export declare const MIN_SUBAGENT_MAX_TURNS = 200;
export declare const ENV_MAX_TURNS = "CODEBUDDY_CODE_MAX_TURNS";
export declare const ENV_SUBAGENT_MAX_TURNS = "CODEBUDDY_CODE_SUBAGENT_MAX_TURNS";
/**
 * Sub-agent max_turns governance: env (operator kill-switch) > tool param > agent definition.
 * Positive-but-too-small values are raised to {@link MIN_SUBAGENT_MAX_TURNS}.
 * `undefined` / 0 keep meaning "no explicit cap, use the agent-service default".
 */
export declare function resolveSubagentMaxTurns(rawMaxTurns?: number, definitionMaxTurns?: number): number | undefined;
/**
 * Disable Fork subagent (subagent_type='fork').
 *
 * When set to a truthy value (parsed via BooleanUtils.isTruthy), the Agent
 * tool will reject any call with subagent_type='fork' and instruct the model
 * to choose a concrete subagent_type instead. The Agent tool description
 * template also omits the fork-mode section so the model never sees it.
 *
 * Hosts that want fork disabled (e.g. WorkBuddy Desktop, where recursive
 * fork-N teammate spawning blew up request volume — Issue #41097) should
 * inject this env when launching the CLI. Default is unset (fork enabled).
 */
export declare const ENV_DISABLE_FORK_SUBAGENT = "CODEBUDDY_DISABLE_FORK_SUBAGENT";
/**
 * Whether fork subagent (subagent_type='fork') is disabled in the current
 * process via env CODEBUDDY_DISABLE_FORK_SUBAGENT (truthy → disabled).
 *
 * Used both by the Agent tool runtime (to reject fork calls as a defensive
 * gate) and by the tool description renderer (to hide the fork-mode section
 * from the model). Keeping a single source of truth avoids the description
 * advertising a feature that the runtime would refuse.
 */
export declare function isForkSubagentDisabled(): boolean;
/**
 * Env var name for {@link isBuiltinSubagentsDisabled}. Declared here (next to
 * {@link ENV_DISABLE_FORK_SUBAGENT}) even though the Set it gates
 * ({@link BUILTIN_DISABLEABLE_SUBAGENTS}) must live after the `AgentNames`
 * enum below — enums are not hoisted in TS, so a Set referencing enum
 * members has to follow the enum declaration.
 */
export declare const ENV_DISABLE_BUILTIN_SUBAGENTS = "CODEBUDDY_DISABLE_BUILTIN_SUBAGENTS";
export declare function isBuiltinSubagentsDisabled(): boolean;
/**
 * Disable background tasks (`run_in_background:true`) for the Agent, Bash and
 * PowerShell tools.
 *
 * Default is unset (background execution allowed). When set to a truthy value
 * (parsed via BooleanUtils.isTruthy), two enforcement layers kick in for each
 * affected tool (issue #63114):
 *   1. Schema layer: the tool's zod schema omits the `run_in_background` field
 *      entirely, so the model never sees it and cannot request it.
 *   2. Runtime layer: the tool's `execute()` keeps a guard that ignores
 *      `run_in_background=true` for stale/cached tool calls that bypass the
 *      schema (history replay, cached prompts, external callers, etc.) and
 *      falls back to synchronous / foreground execution.
 *
 * Rationale: in request-response SDK / print-mode consumers (e.g. antifraud on
 * the Claude Agent SDK, Python), the lead's terminal result is emitted as
 * soon as its own turn ends. Any background agent / background shell spawned
 * inside that turn is orphaned — its result never flows back to the final
 * answer. Hosts that only need one-shot task completion (skills, print-mode
 * reports, etc.) should set this env so the model is forced onto the
 * synchronous / foreground path where results are guaranteed to be included.
 *
 * Scope: the `run_in_background` parameter of the Agent tool AND the Bash /
 * PowerShell shell tools (aligned with Claude Code's
 * `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS`, which gates Agent + Bash + PowerShell
 * alike). Independent of the print-mode guard `BaseTool.isBackgroundExecutionBlocked`,
 * which still blocks background execution in `-p` regardless of this env.
 */
export declare const ENV_DISABLE_BACKGROUND_TASKS = "CODEBUDDY_CODE_DISABLE_BACKGROUND_TASKS";
/**
 * Whether background tasks are disabled in the current process via env
 * CODEBUDDY_CODE_DISABLE_BACKGROUND_TASKS (truthy → disabled). Single source of
 * truth consumed by the Agent / Bash / PowerShell tool schemas (to hide the
 * `run_in_background` field from the model) and by their runtime dispatch (to
 * ignore the field if the model still supplies it via cached / stale prompts).
 */
export declare function isBackgroundTasksDisabled(): boolean;
/**
 * Whether the current `subagent_type` should trigger the built-in fork
 * specialization — i.e. inheriting the parent (default) agent's definition
 * (AgentTask.setupPhase) and injecting parent conversation history into the
 * sub-session (AgentTask.setupSubAgentSession).
 *
 * This is the single source of truth for "is this a fork-mode invocation?".
 * Three sites consume it:
 *   1. AgentTool.execute() — fork-mode dispatch branch
 *   2. AgentTask.setupPhase() — parent-default agent inheritance
 *   3. AgentTask.setupSubAgentSession() — parent-history injection
 *
 * Returns false when fork is disabled via env, in which case the name 'fork'
 * is treated as a regular agent name (a user may legitimately have a custom
 * agent named 'fork' under .codebuddy/agents/).
 */
export declare function shouldApplyForkSpecialization(subagentType: string | undefined): boolean;
export declare const DEFAULT_TEMPERATURE = 1;
export { AgentNames } from './agent-names';
/**
 * Agents that should have access to MCP servers
 */
export declare const AGENTS_WITH_MCP_ACCESS: Set<AgentNames>;
/**
 * Built-in subagents disabled by {@link ENV_DISABLE_BUILTIN_SUBAGENTS} (issue
 * #99451, groundwork for outbound A2A): `general-purpose`, `fork`,
 * `Explore`, `Plan`, `statusline-setup`. `Plan` and `statusline-setup` are
 * product.json-declared agents (tag `sub-agent`) rather than `AgentNames`
 * enum members, so they're listed as string literals here.
 *
 * Does **not** touch custom/plugin/managed agents, Teams, MCP, or A2A — this
 * is strictly a scope-reduction switch for the built-in `Agent` tool's own
 * subagent catalog, independent of `ENV_DISABLE_FORK_SUBAGENT` (which only
 * affects the fork specialization) and independent of the A2A feature gate.
 *
 * Enforcement is two-layered, same pattern as fork-disable:
 *   1. Exposure layer: the Agent tool description omits these agents from
 *      the rendered subagent catalog.
 *   2. Runtime layer: `AgentTool.execute()` rejects a call with
 *      `subagent_type` in this set.
 *
 * Rationale: hosts that want the model to prefer outbound A2A delegation
 * over spawning built-in generic subagents (or that simply want a smaller,
 * more predictable subagent surface) can set the env without having to
 * enumerate every built-in agent name themselves.
 */
export declare const BUILTIN_DISABLEABLE_SUBAGENTS: Set<string>;
export declare function isBuiltinDisableableAgent(agentName: string): boolean;
/**
 * Internal generator agents that run in isolation (context compaction, title generation,
 * summary generation, etc.) and never participate in team / sub-agent communication.
 *
 * These agents must NOT receive the auto-injected SendMessage tool — it would only
 * waste prompt tokens on a tool they can never legitimately call (the SendMessage
 * tool itself returns an error when invoked outside a team context), and for
 * structured-output agents like `compact` it can pollute the model's output.
 *
 * **这些名字是保留字，不得被用作子代理 / teammate 预设名**（评审 #128343）：
 * `resolveMessageSpeakerLabel` 把本名单的判定放在「子会话报自身身份」**之前**，因为历史与
 * 用量多处按 `providerData.agent === 'compact'` 这类字符串比较判定，子会话里跑 compact 时
 * 不能被身份名覆盖。反过来说，一旦有真实子代理取了这里的名字，它的消息会被标成生成器名
 * 而不是自己的身份 —— 属于要靠人眼才能发现的错标。新增名字前先确认它不会与任何预设名撞。
 */
export declare const INTERNAL_GENERATOR_AGENTS: Set<string>;
/**
 * 旁路 generator agent：跑在主 session 上、但不代表"主对话 turn"的辅助 LLM 调用
 * （输入建议、标题、摘要、洞察、记忆筛选等）。它们的 agent_start / agent_end /
 * tool 等生命周期事件【绝不能】驱动主 session 的运行态状态机
 * (SessionRunStateMachine)——否则会在主 turn 仍在 streaming 时把状态机提前翻到
 * idle，触发 IdleQueueDrainService 抢跑队列里的下一条消息，导致两条 user 消息
 * 在 history 里相邻、被模型合并作答（issue #41675：tab queue 连发 1+1?/1+2?
 * 只回一个 "2"）。
 *
 * 本名单按 **agent 名**匹配，因此只适合"该 agent 在任何调用路径上都不代表主 turn"
 * 的情形。若同一个 agent 在不同路径上身份不同（`contextSummary` 即如此），改用
 * purpose 粒度的 `STATE_MACHINE_BYPASS_PURPOSES`。
 *
 * 与 INTERNAL_GENERATOR_AGENTS 的区别：
 * - 这里【刻意排除】COMPACT。它由 blocking-compact-strategy 经 runDefault 派发，
 *   是货真价实的顶层 run（外层 run 已被 skipRun + forceIdle 收尾），session 生命
 *   周期本就该由它持有；旁路掉会让 /compact 期间状态机一直停在 idle，用户此刻发
 *   消息就直接起第二个 run。
 * - 同样【刻意排除】CONTEXT_SUMMARY。它只在 PreMessage 一条路径上会踩到主 run 的
 *   生命周期窗口；MaxToken 与用户显式调用子 agent 时它都是 session 上唯一的 run，
 *   按 agent 名一刀切旁路会让前者长时间停在 PREPARING、后者无法收尾。改由
 *   `STATE_MACHINE_BYPASS_PURPOSES` 精确到 ContextSummaryPreMessage。
 * - 其余 generator 要么本就用独立 session（summary / title 在 runOneTime 不传
 *   context，新建 session），要么显式传主 session（promptSuggestion：
 *   prompt-suggestion-service.ts 传 { context: session }）。对前者加进来是无害的
 *   双保险，对后者是必需的修复。
 */
export declare const STATE_MACHINE_BYPASS_AGENTS: Set<string>;
/**
 * 「生效模型 + 来源」解析结果的来源标签（Issue #66763）。
 *
 * 面板展示与运行时落定共用同一套来源枚举，保证「显示什么」= 「实际跑什么」。
 * - `env-global`      环境变量 CODEBUDDY_CODE_SUBAGENT_MODEL 一刀切接管（能力 A）
 * - `env-variant`     变体环境变量 CODEBUDDY_SMALL_FAST_MODEL / CODEBUDDY_BIG_SLOW_MODEL（能力 B）
 * - `settings-project` 项目级 settings（.codebuddy/settings.json）
 * - `settings-user`   全局级 settings（~/.codebuddy/settings.json）
 * - `product-default` 内置默认声明（product.json 的 agent.models[0]，如 Explore=lite）
 * - `tool-input`      本次调用 Agent 工具的 model 入参（变体，如 default/lite/reasoning），单次生效
 * - `related-models`  主模型的 relatedModels 变体映射（能力 B 现有层）
 * - `inherit`         无任何声明，继承主对话模型
 * - `fallback-main`   配置的模型被禁用 / 本地未知，降级回主对话模型
 */
export type EffectiveModelSource = 'env-global' | 'env-variant' | 'settings-project' | 'settings-user' | 'product-default' | 'tool-input' | 'related-models' | 'inherit' | 'fallback-main';
/**
 * 「生效模型 + 来源」解析结果（Issue #66763，能力 A / B 共用）。
 */
export interface EffectiveModelResolution {
    /**
     * 面板展示用的生效模型标识：具体模型 id、变体名（如 "lite"），或 undefined（继承主模型）。
     * 当 source 为 `inherit` 时，modelId 为主对话模型 id（展示为「继承」但给出实际值）。
     */
    readonly modelId: string | undefined;
    /** 生效来源，决定面板 SOURCE 列与 NOTE 展示。 */
    readonly source: EffectiveModelSource;
    /**
     * 运行时应真正落定给子会话的模型 id。
     * - undefined 表示「继承主对话模型」（不覆盖 session model）。
     * - 与 modelId 的区别：modelId 可能是变体名（展示用），runtimeModelId 一定是可发给网关的
     *   具体 id 或 undefined。
     */
    readonly runtimeModelId: string | undefined;
}
export interface AgentManager {
    readonly ready: boolean;
    getDefault(): Promise<Agent>;
    /**
     * 全局 default agent 的名字（不含 per-session override 派生）。
     */
    getDefaultAgentName(): string;
    /**
     * 本轮 run 是否属于会话的主 Agent。
     *
     * 可选：默认 agent 之外还存在宿主自定义的「主 Agent 形态」（宿主概念，core 不感知）。
     * 未实现的宿主（含历史实现与测试桩）由调用方回退到 `runAgentName === getDefault().name`
     * 的原判据；默认 agent 恒为主运行，不受本方法影响。
     *
     * 契约：必须同步返回、无副作用、不得抛异常 —— 调用点分布在压缩与 Stop hook 链路，
     * 其中部分调用不在 try 保护内，抛错会让该轮压缩退化为跳过。
     */
    isMainAgentRun?(session: Session, runAgentName?: string): boolean;
    /**
     * Whether this exact runtime object was registered in `agentMap`.
     * Historical instances remain managed after a Product rebuild so an
     * in-flight request can recognize and safely rebind them by name.
     */
    isManagedAgentInstance(agent: Agent): boolean;
    /**
     * Create a run-scoped copy of a manager-owned Agent.
     *
     * Model interceptors mutate `model` and `modelSettings`, so concurrent runs
     * must not share the object stored in `agentMap`. The copy retains the
     * standard AgentFactory lifecycle hooks and remains eligible for a late
     * tools-only projection before dispatch.
     */
    /**
     * `session` = the session the run will execute under. MCP scoped servers
     * (session lane / subagent inline) are merged into the clone here, by
     * value — construction can run under another session's context (subagent
     * clones happen inside the parent's run), so ambient resolution is the
     * wrong tool at this point.
     */
    createRunScopedAgent(agent: Agent, session?: Session): Promise<Agent>;
    /**
     * session-agent-view：会话档输入（技能/命令/工具白名单）存在时返回基座 agent
     * 的会话视图（清单类工具描述换成会话内渲染字节），否则原样返回基座。同会话
     * 同输入逐轮返回同一对象（prompt cache 稳定）；视图字节永不写回全局物化面。
     */
    sessionScopedAgentView(session: Session, base: Agent): Promise<Agent>;
    /**
     * sandbox-agent-view：把 REPL 的动态 schema 按子代理身份重新物化一遍。Code Mode 的
     * agent 实例进程级共享（`get('ptc')` 命中同一对象），schema 在构建期用合成会话采集 ——
     * 继承模式的子代理（Explore 等）会看到模式的全量目录。派发侧知道身份，经此覆盖。
     * 只克隆 REPL 一个工具，视图不进 agentMap；空身份 / 同名 / 无 REPL 时原样返回基座。
     */
    sandboxScopedAgentView(base: Agent, sandboxAgentName: string): Promise<Agent>;
    /** served 激活链的视图预热（默认 agent），派发路径是失效兜底。 */
    prepareSessionAgentView(session: Session): Promise<void>;
    get(agentName: string): Promise<Agent | undefined>;
    /**
     * Gate-free：`agentMap` 里已经注册好的实例。**不 await** `readyDeferred`。
     *
     * REPL 骨架 / ToolSearch 白名单在 `rebuildAgents` 期间也会问「这个 agent
     * 能用哪些工具」。走 `get()` 会和 `readyDeferred` 互相等（见 REPLTool
     * renderSkeleton 注释）。实例还没进 map 时返回 `undefined`，调用方应再读
     * `getAllConfigs()` 的声明工具名。
     */
    getRegistered(agentName: string): Agent | undefined;
    getAll(): Promise<Agent[]>;
    /**
     * 主 agent 目录等“只需要展示字段”的路径使用的配置视图。
     *
     * 只等配置解析就绪（`configReadyDeferred`），**不等** agent 注册期的
     * MCP settle / 工具构建。侧边栏 agents/modes 列表从这里读可以避免被
     * `rebuildAgents` 的完整注册拖慢；`set_agent` 仍走 `get()` 做存在性校验。
     */
    getAllConfigs(): Promise<ProductAgentConfiguration[]>;
    getCommands(agentName: string): Promise<Command[]>;
    getModels(agentName: string): Promise<LanguageModel[]>;
    getModel(agentName: string): Promise<LanguageModel>;
    /**
     * `getModel` 的 gate-free 版本：**不 await** `readyDeferred` /
     * `modelsReadyDeferred` / `pendingInitializeOverride`，直接基于当前的
     * `agentConfigMap` / `modelMap` / settings 计算模型。
     *
     * 仅供 rebuild 内部 render 上下文（如 `ModelPromptContextInitializer`）使用
     * ——run 路径（get/getDefault）里的 render 会经过 `promptContextProvider`，
     * 若走标准 `getModel` 会形成循环等待：rebuild 内 render → getModel →
     * awaitPendingInitializeOverride → 反过来等 rebuild 完成，只能靠
     * `waitForRebuildSettled` 3s 超时拆环（见 issue #84036）。
     *
     * 语义与 `getModel` 一致（同一个内部 `computeModel`），仅省掉就绪 gate；
     * 如果调用发生在 configReady 之前，可能拿不到实际 model 配置，此时
     * caller 应容忍空/兜底。
     */
    getModelForContext(agentName: string): Promise<LanguageModel | undefined>;
    /**
     * `getModels` 的 gate-free 变体：不await 就绪 gate，直接从 `agentConfigMap` /
     * `modelMap` 计算列表。适用场景同 `getModelForContext`。
     */
    getModelsForContext(agentName: string): LanguageModel[];
    /**
     * 元信息快照，供 SDK `initialize` 握手使用：default agent 名、其可用模型、
     * 当前主模型 id。
     *
     * 与 `getDefault()` + `getModels()` 的关键区别：首次调用直接读取轻量 Product
     * 快照，不等待 agent 注册期的 MCP settle。空/无 default 的早期快照不会永久
     * 缓存；rebuild 已经落定时会 gate-free 地使用当前 runtime catalog 修复结果。
     */
    getInitializeMetadata(): Promise<{
        defaultAgentName: string;
        models: LanguageModel[];
        currentModelId?: string;
    }>;
    /**
     * 获取主模型（用户选择的模型，即 default agent 使用的模型）
     * @returns 主模型
     */
    getPrimaryModel(): Promise<LanguageModel>;
    /**
     * 获取指定模型在特定场景下的关联模型
     * @param primaryModelId 主模型 ID
     * @param variantType 场景类型 (lite, builtin-lite, reasoning, vision, longContext, subagent)
     * @returns 关联模型，如果没有找到则返回主模型本身
     */
    getRelatedModel(primaryModelId: string, variantType: ModelVariantType): Promise<LanguageModel>;
    /**
     * 解析模型字符串，统一处理 variant type 和普通模型 ID
     * @param modelStr 模型字符串，可以是：
     *   - 场景类型（如 "lite", "builtin-lite", "reasoning"），根据主模型动态解析
     *   - 模型 ID（如 "gpt-5.1-codex"），直接查找对应模型
     * @param session 可选会话上下文（Issue #82146）：解析 variant 时继承的"主模型"
     *   优先取 session.requestOptions.model / session.options.model（会话运行时选择），
     *   无会话显式选择时回落启动默认（env CODEBUDDY_MODEL / settings / agent 默认）。
     * @returns 解析后的模型，如果找不到则返回 undefined
     */
    resolveModel(modelStr: string, session?: Session): Promise<LanguageModel | undefined>;
    /**
     * 解析配置级 model（slash command / skill / subagent 的 model 字段或 agent config models[0]）。
     * 匹配不到或命中 disabled 模型时，静默降级到主 agent 当前选中的模型 id，并记一条 warn。
     * 空入参返回 undefined，调用方走"未指定"分支。
     * @param requestedModel 要解析的 model id / name / variant（'lite' / 'builtin-lite' / 'reasoning' / 'default'）
     * @param sourceLabel 日志来源标签
     * @param session 可选会话上下文；解析 variant 时保持与当前 session 主模型一致
     * @returns 最终 model id；入参为空时返回 undefined
     */
    resolveConfiguredModelOrFallback(requestedModel: string | undefined, sourceLabel: string, session?: Session): Promise<string | undefined>;
    /**
     * 解析某个内置子 Agent 的「生效模型 + 来源」（Issue #66763，能力 A 的唯一事实源）。
     *
     * 优先级从高到低：
     *   ① env CODEBUDDY_CODE_SUBAGENT_MODEL（一刀切，最高）
     *   ② explicitModel（本次调用工具入参 variant，可选）
     *   ③ settings.subagents.agents[agentName].model（项目级 > 全局级，由配置管理器合并）
     *   ④ product.json 内置默认 agent.models[0]（如 Explore=lite）
     *   ⑥ 继承主对话模型（兜底）
     * 命中的模型被禁用 / 本地未知时降级为继承主模型（source=fallback-main）。
     *
     * 运行时（AgentTool spawn）与 /agents 面板共用本函数，避免「显示 A 实际跑 B」。
     *
     * @param agentName 子 Agent 名称（与 product.json agents[].name 对齐）
     * @param explicitModel 本次调用显式指定的 model 入参（可选；'default'/'inherit'/空视为未指定）
     * @param session 发起调用的会话（可选，Issue #149675）：继承 / 变体解析的「主模型」优先取
     *   session.requestOptions.model / session.options.model，缺省时回落启动默认。
     */
    resolveEffectiveSubagentModel(agentName: string, explicitModel?: string, session?: Session): Promise<EffectiveModelResolution>;
    /**
     * 解析某个通用场景变体（lite / reasoning）的「生效模型 + 来源」（Issue #66763，能力 B）。
     *
     * 复用 getRelatedModel 的既有链路并补充来源标注，供 /model 面板「场景变体区」展示。
     * 优先级：env（按变体）> settings.variantModels[variant]（项目 > 全局）> 主模型 relatedModels
     *        > 自定义模型短路 > 全局 defaultRelatedModels > 主模型兜底。
     *
     * @param variant 变体名（UI 仅开放 'lite' | 'reasoning'；'builtin-lite' 为隐藏内置场景）
     * @param session 可选会话上下文（Issue #82146）：继承的"主模型"优先取
     *   session.requestOptions.model / session.options.model（会话运行时选择），
     *   无会话显式选择时回落启动默认（env CODEBUDDY_MODEL / settings / agent 默认）。
     */
    resolveEffectiveVariantModel(variant: ModelVariantType, session?: Session): Promise<EffectiveModelResolution>;
    /**
     * 获取 agent 的原始产品配置
     * @param agentName agent 名称
     * @returns 原始产品配置，如果找不到则返回 undefined
     */
    getAgentConfig(agentName: string): Promise<ProductAgentConfiguration | undefined>;
    /**
     * 刷新特定 agent 的工具列表。用于在 delegate tools 注册后动态更新 DelegateTool 的描述。
     * @param agentName agent 名称
     */
    refreshAgentTools(agentName: string): Promise<void>;
    /**
     * Run-path only guard: if a late-connecting MCP server indexed its deferred
     * tools after `agentName` was built, wait for MCP to settle and re-bake the
     * map-current agent so the first run carries those tools. When `exactAgent`
     * is a manager-registered runtime, project those latest tools onto that
     * exact run object. Derived/per-request Agent overrides are never mutated.
     * Must be called only from the run path (not `get`/`getDefault`), to keep
     * `initialize`/`get_available_models` off the MCP-settle critical path.
     */
    ensureAgentToolsFreshForRun(agentName: string, session: Session, signal?: AbortSignal, exactAgent?: Agent): Promise<void>;
    /**
     * TUI 静默启动阶段的显式预触发入口。TUI ready 后 fire-and-forget 调用一次，
     * 让 `McpFirstRunStatusService.emitStart` 提前发出，`McpStartupBanner` 组件
     * 无需等首个用户消息就能渲染顶部状态行。
     *
     * 与首个 prompt 的 run 路径共享同一进程级 latch：warm-up 先跑则首个 prompt
     * 直接 await 已 resolve 的 promise，反之亦然，绝不会重复触发
     * `waitForPendingServers` / 重复emit 事件。
     */
    warmupFirstRunMcpPrewait?(agentName: string, session: Session): Promise<'completed' | 'aborted'>;
    /**
     * 中断进程级 first-run prewait 等待——**不停 MCP 后台建联**。
     *
     * 语义：`waitForPendingServers` 立刻返回，`McpFirstRunStatusService.emitFinish`
     * 会把未 settle 的 server 标记为 `timeout`；agent-service.run 立即用当前
     * 已连的 MCP 集派模型请求。未 ready 的 MCP 仍会在后台 reconcile，下一轮
     * rebuild 时它们的工具正常并入。
     *
     * 幂等：latch 未激活或已中断时为 no-op。
     */
    interruptFirstRunMcpPrewait?(): void;
    /**
     * 获取当前进程内的临时 plugin agent override 状态。
     */
    getVolatilePluginAgentState(): {
        agentName?: string;
        sourcePluginId?: string;
        internalModelRequestHeaders?: Record<string, string>;
    };
    /**
     * 设置当前进程内的临时 plugin agent override。
     * @returns 是否发生了实际变更
     */
    setVolatilePluginAgent(agentName?: string, options?: {
        rebuild?: boolean;
        sourcePluginId?: string;
        internalModelRequestHeaders?: Record<string, string>;
    }): Promise<boolean>;
    /**
     * 获取 settings.json 或 --agent 指定的有效 agent 名称。
     * 当用户通过 settings 配置了非默认 agent 时返回该名称，否则返回 undefined。
     */
    getSettingsAgentName(): string | undefined;
    /**
     * 进程 argv 上的 `--agent`（不经过 applySettingsAgent）。
     * 新建智能体 fork 后 rebuild 尚未写 settingsAgentName 时，站立盖章仍要读到 ptc。
     */
    getCliAgentName(): string | undefined;
    /** Force one rebuild from the current runtime snapshot and wait strictly. */
    refreshAgents?(): Promise<void>;
    /**
     * 等待 agent 重建进入稳定态：既不在 rebuilding，也没有挂起的 pendingRebuild。
     * @param timeoutMs 最长等待时间（ms）。默认 3000ms；小于等于 0 表示不设超时。
     */
    waitForRebuildSettled(timeoutMs?: number): Promise<void>;
    /**
     * rebuild 进入稳定态时通知（既不在 rebuilding，也没有 pendingRebuild）。
     * CLI Web UI 用它在企业模型 / 远端配置到位后补推 model_update。
     * 订阅必须按客户端门禁，不得让 WorkBuddy 吃到额外 model_update。
     */
    onDidRebuildSettled(listener: () => void): {
        dispose(): void;
    };
    /**
     * 登记一次「在后台执行」的初始化覆盖（SDK initialize 的 systemPrompt / agents
     * 注入 → productManager.sync + rebuild）。SDK `initialize` 握手把这个耗时且会
     * 阻塞在 MCP settle 上的动作从关键路径挪到后台，握手立即返回；而 `get()` /
     * `getDefault()`（发消息 / run 的必经入口）会 await 本 promise，保证首个 prompt
     * 一定跑在覆盖生效之后的 agent 上，而不是覆盖前的默认人设。
     *
     * 多次登记按串行链累积，单个失败不影响后续等待。
     * @param promise 后台覆盖动作的完成 promise
     */
    trackPendingInitializeOverride(promise: Promise<void>): void;
}
export interface CreateCustomAgentResult {
    agent?: CustomAgent;
    success: boolean;
    error?: string;
}
export interface CustomAgentManager {
    createByAI(session: Session, description: string, createScope: CustomAgentScope): Promise<CreateCustomAgentResult>;
    delete(agentName: string): Promise<void>;
    get(agentName: string): CustomAgent | undefined;
    getAll(): CustomAgent[];
    /** Web「打开文件」用：解析可打开的 markdown 路径，不拉系统编辑器 / vim。 */
    resolveSettingsPath(agent: CustomAgent): Promise<string>;
    openSettings(agent: CustomAgent, options?: {
        allowTerminalEditor?: boolean;
    }): Promise<void>;
}
export interface AgentFactory {
    create(options: AgentOptions): Promise<Agent>;
}
export interface RunnerFactory {
    create(config?: Partial<RunConfig>): Promise<Runner>;
}
export interface RunnerProvider {
    get(): Promise<Runner>;
}
type AgentSdkRunOptions<TContext> = NonStreamRunOptions<TContext> | StreamRunOptions<TContext>;
/** Agent CLI controls consumed before options reach the OpenAI runner. */
export interface AgentServiceRunControlOptions {
    bypassMessageQueue?: boolean;
    /** Remote-owned cancellation must not cascade into a prior local UI run. */
    isolatePreviousRunOnCancel?: boolean;
    /** A shared UI remote turn must never replace a still-running local cancellation owner. */
    requireIdleForIsolatedRun?: boolean;
    /** Input is already present in Session history; do not append it again. */
    skipAddHistory?: boolean;
    /** Let an interactive host route external `/compact` before normal run admission. */
    routeManualCompact?: boolean;
    /**
     * Per-call out-signal of `runDefault`: invoked once, synchronously, after
     * this call passed run admission (its startup controller is installed on
     * the Session) and before the agent is resolved. Not invoked when admission
     * throws. It says nothing about the model having started or the run
     * succeeding; without `bypassMessageQueue` the run may still be queued
     * afterwards (see `onEnqueued`). A throwing callback is logged and does not
     * affect the run. Internal re-runs pass fresh options and never carry it; it
     * is stripped before AgentRunRequest and the SDK.
     */
    onAdmitted?: () => void;
    /** Await durable recovery admission before resolving the agent. Failure aborts this run. */
    beforeRun?: () => Promise<void>;
}
/** Options for an isolated run or an SDK RunState resume. */
export type AgentStandardRunOptions<TContext = Session> = AgentSdkRunOptions<TContext> & AgentServiceRunControlOptions & {
    /** Process-local provenance for fresh user turns; stripped before SDK dispatch. */
    inputOrigin?: AgentRunOrigin;
    /** Which UI a human turn came from; only meaningful with `inputOrigin: 'human'`. Defaults to `other`. */
    inputSurface?: HumanInputSurface;
    continuation?: never;
    /**
     * Per-arrival out-signal: invoked when this run was routed to the message
     * queue (skipRun, session busy) instead of executing now. Callers that owe
     * their caller *this* prompt's own result (print / stream-json) use it to
     * keep waiting until the queue drains and their turn actually runs.
     *
     * A run-scoped callback (not a shared session flag) so concurrent arrivals
     * cannot clobber each other's outcome.
     */
    onEnqueued?: () => void;
    /** Exact result of this arrival, including execution after a queue drain. */
    onResult?: (result: NonNullable<Session['resultSubject']['value']>) => void;
};
/**
 * Explicitly claim the current process-local logical turn.
 *
 * This is intentionally limited to fresh input on a concrete Session. A
 * RunState already identifies the SDK state being resumed and cannot combine
 * that identity with an ambient continuation.
 */
export type AgentCurrentContinuationOptions = AgentSdkRunOptions<Session> & AgentServiceRunControlOptions & {
    context: Session;
    inputOrigin?: AgentRunOrigin;
    inputSurface?: HumanInputSurface;
    continuation: AgentRunContinuation;
};
export type AgentServiceRunOptions<TContext = Session> = AgentStandardRunOptions<TContext> | AgentCurrentContinuationOptions;
export interface ReviewerRecovery {
    modelSelectionFallback?: 'deepseek_flash_unavailable';
    primaryModelId?: string;
    primaryFailureReason: SecurityReviewFailureReason;
    primaryCircuitOpen?: boolean;
    fallbackModelId?: string;
    fallbackOutcome: 'pending' | 'succeeded' | 'failed' | 'skipped';
    fallbackFailureReason?: SecurityReviewFailureReason;
    fallbackSkippedReason?: 'same_model' | 'caller_missing';
}
export interface ReviewerOneTimeRequest {
    agentName: AgentNames.SECURITY_REVIEWER;
    systemPrompt: string;
    userPrompt: string;
    temperature: number;
    signal?: AbortSignal;
    purpose: AgentPurpose.SecurityReviewer | AgentPurpose.ContentSecurityReviewer;
    /** 只用于解析当前主模型和关联上报，不向审查调用复制历史、工具或权限。 */
    callerSession?: Session;
    /** 首次失败时立即通知，整体超时也能保留回退前的错误。 */
    onRecovery?: (recovery: ReviewerRecovery) => void;
    reviewType: SecurityReviewType;
    /** 模型已返回但输出不构成有效结论时返回失败原因，用于判定本次调用是否成功。 */
    validateResult?: (result: ReviewerOneTimeResult) => SecurityReviewFailureReason | undefined;
    /** 每次模型调用结算一次；signal 以 'timeout' 为 reason 中止时记为超时。 */
    onModelCall?: (call: SecurityReviewModelCallPayload, callerSession?: Session) => void;
}
export interface ReviewerOneTimeResult {
    output: string;
    finishReason?: string;
    usage?: Pick<Usage, 'inputTokens' | 'outputTokens'>;
    /** 网关返回的本次模型调用实际积分。 */
    credit?: number;
}
export interface AgentService {
    /** Atomically close a task's runtime only after its last result and queued work settle. */
    tryCloseTaskSession?(session: Session, result: NonNullable<Session['resultSubject']['value']>): Promise<boolean>;
    /** Stop accepting task work and join its physical runs before releasing dependencies. */
    retireTaskSession?(session: Session): Promise<void>;
    /**
     * 有界等待该 session 上的物理 run 收尾（含它把最终产出写进 history）。
     *
     * `agent_end` 早于 run 的 finalize，所以「上一轮 history 已写完」不能靠 `agent_end`
     * 判定；需要该因果的调用方（队列 drain）join 到这里。超时会放行并告警，不会挂死。
     */
    waitForRunsSettled?(session: Session): Promise<void>;
    run<TAgent extends Agent<any, any>>(agent: TAgent, input: string | AgentInputItem[], options: AgentCurrentContinuationOptions): Promise<void>;
    run<TAgent extends Agent<any, any>, TContext = Session>(agent: TAgent, input: string | AgentInputItem[] | RunState<TContext, TAgent>, options?: AgentStandardRunOptions<TContext>): Promise<void>;
    runDefault<TAgent extends Agent<any, any>>(input: string | AgentInputItem[], options: AgentCurrentContinuationOptions): Promise<void>;
    runDefault<TAgent extends Agent<any, any>, TContext = Session>(input: string | AgentInputItem[] | RunState<TContext, TAgent>, options?: AgentStandardRunOptions<TContext>): Promise<void>;
    /**
     * Run an auxiliary one-shot request.
     *
     * When `options.context` is an existing Session, the request inherits
     * cancellation from both `options.signal` and the Session owner captured at
     * invocation time, but never replaces that owner. The input options object is
     * not mutated. Cancellation rejects with `AbortError` and never returns partial
     * text; settlement waits for the SDK stream loop to physically finish.
     */
    runOneTime<TContext = Session>(agentName: string, input: string | AgentInputItem[], options?: NonStreamRunOptions<TContext> & OneTimeRunOptions): Promise<string>;
    runReviewerOneTime(request: ReviewerOneTimeRequest): Promise<ReviewerOneTimeResult>;
    runOneTime<TContext = Session>(agentName: string, input: string | AgentInputItem[], options?: StreamRunOptions<TContext> & OneTimeRunOptions): Promise<string>;
    /**
     * Run a one-shot agent call in a forked (isolated) session that inherits
     * the conversation history from the parent session. The forked session is
     * ephemeral — its messages are NOT written back to the parent.
     *
     * This is the agent-cli equivalent of claude-code's runForkedAgent:
     *   initialMessages = [...forkContextMessages, ...promptMessages]
     *
     * @param agentName      Agent to run (e.g., 'general-purpose')
     * @param input          New message(s) to send
     * @param parentSession  Session whose history provides conversation context
     * @param forkedOptions  Fork-specific options (disableTools, etc.)
     * @returns              The agent's text response
     */
    runForked(agentName: string, input: string | AgentInputItem[], parentSession: Session, forkedOptions?: ForkedAgentOptions): Promise<string>;
    /**
     * Enhanced version of runOneTime that supports per-request overrides
     * for temperature, maxTokens, and maxTurns.
     *
     * Used by the Pulse pipeline (via /api/v1/llm/completions) to control
     * LLM parameters and Agent Loop iterations for web search scenarios. It has
     * the same cancellation, owner-preservation, physical-settlement and
     * non-mutating options contract as {@link runOneTime}.
     *
     * @param overrides.bypassPermissions - When true, sets session to BypassPermissions mode,
     *   allowing tools like WebFetch/WebSearch to execute without interactive authorization.
     *   Essential for headless/REST scenarios where user confirmation is not possible.
     *
     * @param agentName  Agent to run (e.g., 'pulse')
     * @param input      Message(s) to send
     * @param overrides  Per-request parameter overrides
     * @param options    Standard run options
     * @returns          The agent's text response
     */
    runOneTimeWithOverrides<TContext = Session>(agentName: string, input: string | AgentInputItem[], overrides?: {
        temperature?: number;
        maxTokens?: number;
        maxTurns?: number;
        systemPrompt?: string;
        bypassPermissions?: boolean;
        /** Provider stop sequences (OpenAI-compatible `stop`), via modelSettings.providerData. */
        stopSequences?: string[];
        /**
         * Force-disable reasoning/thinking for this one call by dropping
         * `modelSettings.reasoning`. Used by the auto-mode classifier: it only
         * needs a tiny `<block>yes/no</block>` output, so reasoning would just
         * consume the small output budget and can starve the visible answer.
         */
        disableReasoning?: boolean;
        /**
         * Explicit reasoning effort for this one-shot call.
         * 'none' disables thinking in the HTTP body (reasoning_effort="none").
         * Other values ('low'/'medium'/'high') set the corresponding effort.
         * Takes precedence over disableReasoning when both are set.
         * Used by title generation to explicitly disable thinking for local models.
         */
        reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
        /**
         * Explicit model id/name/alias for this one-shot run. Takes precedence
         * over the agent's own model resolution when provided (non-empty).
         * Used e.g. by WorkBuddy enhance-prompt to follow the user's selected model.
         */
        model?: string;
        /** Caller opt-in: require an explicit model that resolves to an enabled model. */
        strictModel?: boolean;
    }, options?: NonStreamRunOptions<TContext> | StreamRunOptions<TContext>): Promise<string>;
}
/**
 * Options specific to forked agent execution.
 * Mirrors claude-code's ForkedAgentParams capabilities.
 */
export interface ForkedAgentOptions {
    /** When true, all tools are removed from the agent (default: false) */
    disableTools?: boolean;
    /** Optional cap on number of turns (default: 1 for one-shot) */
    maxTurns?: number;
    /** Follow the parent session's selected runtime model for this isolated call. */
    inheritParentModel?: boolean;
    /** Compact an isolated snapshot of the parent context before this fork when it exceeds the model budget. */
    compactContextOnOverflow?: boolean;
}
/** Options of `runOneTime` on top of the SDK run options. */
export interface OneTimeRunOptions {
    /** X-Agent-Purpose of the call; defaults to the agent's `AGENT_PURPOSE_MAP` entry, else its name. */
    purpose?: string;
    /**
     * 本次一次性调用使用的模型 id / name / alias。
     * 解析成功时优先于会话当前模型和 agent 默认模型；解析不到时回落到原有解析。
     * 用于切换模型后的压缩摘要：阈值按新模型，摘要请求仍走切换前的模型。
     */
    model?: string;
    /**
     * 本次调用的 modelSettings，整体替换 run-scoped agent 的 modelSettings，不写回共享 agent。
     * 按会话变化的参数（如 maxTokens）必须走这里：共享 agent 实例进程内各会话共用，
     * 先写共享实例再调用会被并发会话覆盖。
     */
    modelSettings?: Agent['modelSettings'];
}
export interface RunRequest {
    prompt?: string;
    inputFormat?: 'text' | 'stream-json';
    maxTurns?: number;
    print?: boolean;
    traceId?: string;
    parentSpanId?: string;
    /** W3C propagation carrier supplied by stream-json or another request boundary. */
    _meta?: Record<string, unknown> | null;
    /**
     * 发起本次请求的客户端（print / stream-json 入口经 HTTP body 透传）的遥测公共字段。
     * 由 AgentController 写入 `session.telemetryClientInfo`（对齐 traceId 范式），供 `/v2/report`
     * 按发起端归属公共字段。缺省时走进程级 provider 兜底。ACP 入口走 `_meta`，不经此字段。
     */
    telemetryClientInfo?: import('../session/session-protocol').TelemetryClientInfo;
    /**
     * stdio stream-json 长轮询旁路（B1）：客户端在 stdin 主循环之外并行发的
     * "drain-wait" 请求。server 端不跑 prompt，而是挂起等本 session 后台任务完成信号，
     * 被唤醒后跑一次空 drain-run 消费队列里的 <task-notification>，事件在这条响应上推回。
     * 见 agent-task/stream-json-drain-trigger.ts。
     */
    drainWait?: boolean;
    /**
     * stdin 收到本条用户 message 的本地时间戳（Date.now() ms）。由 cli-executor 在 stdin
     * 读到一行 user message 的最早时刻记录并透传，用作"收到 message → 发出模型请求"耗时的
     * 真实起点——覆盖 stdio 常驻模式下 prompt 到达后等 readyDeferred / agent 就绪 的那段
     * （这段发生在 AgentService.run 入口之前，用 run 入口做起点会漏掉）。
     */
    stdinReceivedAt?: number;
}
export interface AgentRunRequest<TContext = Session> extends SessionOptions {
    input: string | AgentInputItem[] | RunState<any, any>;
    agent: Agent;
    session: Session;
    agentOptions: NonStreamRunOptions<TContext> | StreamRunOptions<TContext>;
    skipRun?: boolean;
    /** Accepted command/skill that intentionally completes without a model run. */
    recordOnly?: boolean;
    skipAddHistory?: boolean;
    bypassMessageQueue?: boolean;
    inputOrigin?: AgentRunOrigin;
    /**
     * Whether the batch admitted by MessageQueue contains an external user prompt.
     * Captured before History replaces input with the active conversation history.
     */
    hasExternalUserPromptAtAdmission?: boolean;
    /** Admitted input consists solely of runtime background-task notifications, before History expansion. */
    backgroundTaskNotificationOnly?: boolean;
    /** Process-local arrival callback; never passed to the SDK. */
    onResult?: AgentStandardRunOptions['onResult'];
    /** Original isolated caller signal, retained across queue cloning for a remote-owned turn. */
    queuedCancellationSignal?: AbortSignal;
    /** Signal selected from a queued batch, distinct from this drain call's own signal. */
    drainedCancellationSignal?: AbortSignal;
    traceId?: string;
    /**
     * #59319-5: 普通 run 二次裁决发现 session 仍 busy 时由 AgentService 设置。
     *
     * 语义：admission gate 已确认此普通 run 没有 lifecycle owner 且 session 仍 busy，
     * MessageQueue interceptor 必须按 busy 分支入队，即使 `isBusyForQueue` 在
     * PREPARING 状态下通常返回 false。
     *
     * 仅对普通 user run 设置；compact、bypass、skipRun 前置豁免不受影响。
     */
    forceMessageQueue?: boolean;
    /** Transient carrier selected by queue arbitration for this physical turn. */
    turnCarrierCandidate?: W3CTraceContextMeta;
    /** The selected carrier came from a previously queued batch, not this call boundary. */
    turnCarrierFromQueue?: boolean;
}
export interface AgentRunInterceptor {
    /**
     * 优先级，大->小 执行（数值越大越先执行）；必须 > 0，否则被过滤不执行。
     */
    priority: number;
    /**
     * 拦截处理请求，可设置 skipRun 终止后续执行
     * @param request 请求对象
     */
    intercept(request: AgentRunRequest): Promise<void>;
}
/**
 * AgentRunInterceptor 的优先级取值（数值越大越先执行）。
 * 枚举自上而下即真实执行顺序：TokenCalculationAbortSnapshot(2100) 最先、TokenCalculation(500) 最后。
 */
export declare enum AgentRunInterceptorPriority {
    /**
     * `/context` 假 run：在任何会 await 的 interceptor 之前快照诊断 abort。
     */
    TokenCalculationAbortSnapshot = 2100,
    Env = 2000,
    UserInput = 1900,
    SensitiveUserInput = 1850,
    HumanInputProvenance = 1840,
    MessageQueue = 1800,
    /** Prepare resumed team runtime after queue merge, before consuming human provenance. */
    TeamRuntimeResume = 1780,
    /** Resolve queued human origin after queue merge, before History. */
    TeamResumeIntent = 1775,
    ReferencePathProcessor = 1750,
    ConditionalRules = 1740,
    SkipRun = 1700,
    PreMessageCompact = 1650,
    AgentSwitch = 1600,
    ProviderData = 1500,
    /**
     * 主 agent（--agent / settings.agent）定义的 initialPrompt 前置注入。
     * 必须在 AgentSwitch(1600) 之后（agent 已定型）、History(1400) 之前
     * （注入后的消息随首轮一起写入历史，恢复会话不会重复注入）。
     */
    InitialPrompt = 1450,
    History = 1400,
    /**
     * Per-session systemPrompt override (server surface E23). Must sit below
     * History (the run-scoped clone happens right after that boundary, so the
     * write lands on the clone) and above the context injectors
     * (Teammate/Memory/...) so they layer on the overridden base.
     */
    SystemPromptOverride = 1350,
    MessageReorganize = 1300,
    SandboxLifecycle = 1210,
    SystemReminderContext = 1200,
    WorktreeContext = 1190,
    TeamContext = 1175,
    /**
     * Issue 5 · injects `<teammate-failures>` into the team-lead's system
     * prompt right after TeamContext so the main agent sees failed teammates
     * before it starts reasoning for the next turn. Kept above MemoryContext
     * since failure notice is higher-priority than recalled memory.
     */
    TeammateFailureContext = 1160,
    MemoryContext = 1150,
    ImageCompression = 1075,
    ImageRehydration = 1050,
    UserQueryWrapper = 1025,
    State = 1000,
    Model = 900,
    JsonSchema = 875,
    ImageFilter = 850,
    Continued = 800,
    Telemetry = 700,
    Sandbox = 550,
    TokenCalculation = 500
}
export * from './agent-tags';
export declare enum CustomAgentScope {
    PROJECT = "project",
    USER = "user"
}
export declare enum CustomAgentSavePath {
    PROJECT = ".codebuddy/agents/",
    USER = "~/.codebuddy/agents/"
}
export declare enum OutputStyleType {
    DEFAULT = "default",
    PROACTIVE = "proactive",
    CONCISE = "concise",
    EXPLANATORY = "explanatory",
    LEARNING = "learning"
}
export declare const CLI_OUTPUT_STYLE_DESCRIPTION_TEMPLATE = "cli-output-style-description";
export interface CustomAgent {
    name: string;
    description: string;
    model?: string;
    systemPrompt: string;
    location: CustomAgentScope;
    tool?: string;
    color?: string;
    /** 原始 markdown 文件绝对路径；由 provider 填充，删除/打开时精确定位。 */
    filePath?: string;
}
/**
 * Agent Completion Waiter Interface
 *
 * Provides a unified way to wait for all post-processing to complete.
 * This replaces scattered deferred promise checks in core code.
 *
 * @example
 * ```typescript
 * // In Controller
 * await runAgent();
 * await this.completionWaiter.waitForCompletion(session);
 * ```
 */
export interface AgentCompletionWaiter {
    /**
     * Wait for all post-processing to complete for a session
     *
     * @param session - The session to wait for
     */
    waitForCompletion(session: Session): Promise<void>;
    /**
     * Register a completion promise for a session
     * Called by post-processors when they need to block completion
     *
     * @param session - The session
     * @param promise - Promise that resolves when processing is complete
     */
    registerCompletion(session: Session, promise: Promise<void>): void;
    /**
     * Clear any registered completions for a session
     * Called when session ends or is cleaned up
     *
     * @param session - The session to clear
     */
    clearCompletion(session: Session): void;
}
//# sourceMappingURL=agent-protocol.d.ts.map