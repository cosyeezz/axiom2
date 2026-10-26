import { AgentManager, Session, SessionManager } from '../../vendor/cbc-core/node/index.js';
import { Agent } from '@genie/product';
export { isSessionBlank } from './main-agent-session';
/**
 * 主 Agent 选择的 ACP 处理（设计 v0.6 §3.5/§3.6/§3.7）。
 *
 * 独立文件承载业务逻辑，acp-agent.ts 的 extMethod dispatch 只做接线：
 * - `_codebuddy.ai/getAgents`：agents 目录（内置/自定义/插件，过滤内部编排 agent，
 *   默认 agent 单独放行，broken 逐条隔离）+ currentAgentName + sessionBlank；
 * - `session/set_agent`：校验链（会话类型 → opt-in/gate → agent 存在 → 仅空白会话）
 *   → 写 session.meta[mainAgent 键] + 同步 session.agentName + 显式 save()
 *   → 会话级模型联动（不落全局 settings）→ configChangeEvent。
 */
/** 目录条目（ACP 响应面，source 复用 AgentDisplaySource 真值） */
export interface MainAgentDirectoryEntry {
    name: string;
    displayName: string;
    description?: string;
    source: 'user' | 'project' | 'managed' | 'plugin' | 'cli-arg' | 'built-in';
    custom: boolean;
    /** 仅 agent 显式声明 model 时返回；未声明省略（避免误导"每 agent 有独立模型"） */
    modelId?: string;
    /** 未声明 model → 继承全局（shouldInheritDefaultAgentSelection 语义） */
    modelInherited?: boolean;
    /** 解析失败原因（broken 语义：逐条隔离，不整体失败） */
    broken?: string;
}
/** getAgents 响应 */
export interface GetAgentsResult {
    defaultAgentName: string;
    currentAgentName?: string;
    sessionBlank?: boolean;
    agents: MainAgentDirectoryEntry[];
}
/** set_agent 响应（模型目录为权威刷新源） */
export interface SetAgentResult {
    agentName: string;
    models: unknown[];
    currentModelId: string;
    sessionBlank: boolean;
}
/** handler 依赖面（由 acp-agent 注入，避免反向依赖） */
export interface MainAgentAcpDeps {
    agentManager: AgentManager;
    sessionManager: SessionManager;
    /** 进程级 gate 同步布尔（MainAgentGateProvider.isEnabled()） */
    gateEnabled(): boolean;
    /** 连接维度 opt-in（clientCapabilities._meta['codebuddy.ai'].mainAgentSupport） */
    optIn(): boolean;
    /** 当前 ACP 连接 ID；用于校验目标 session 是否属于本连接。 */
    connectionId?: string;
    logger?: {
        warn?: (msg: string, ...args: any[]) => void;
        info?: (msg: string, ...args: any[]) => void;
    };
    /** 模型目录快照（set_agent 响应权威刷新源；由 acp-agent 提供现有 getModelsInfo 结果） */
    resolveModels(session: Session): Promise<{
        models: unknown[];
        currentModelId: string;
    }>;
    /** thinking 联动（后端评审 P1-5）：模型实际变化后清理会话级思考覆盖（对齐 set_model） */
    reconcileThinking(session: Session): Promise<void>;
    /** 触发 config 广播（configChangeEvent + acp-view 重算 configOptions） */
    notifyConfigChanged(sessionId: string, configId: string, value: string): void;
    /** settings 配置的默认主 agent（codebuddy.mainAgent.default，设置页"设默认"） */
    getConfiguredDefaultName(): Promise<string | undefined>;
    /** 上次 chip 选择（codebuddy.mainAgent.lastUsed）；不是「设为默认」 */
    getLastUsedName?(): Promise<string | undefined>;
    /** 用户显式选主 agent 后写入 lastUsed（不碰 default） */
    persistLastUsedName?(name: string): Promise<void> | void;
    /**
     * ACP / Web UI locale for shipped-mode overlay.
     * Omit / undefined → English. Only zh* / 中文 / chinese use Chinese.
     * TUI must return undefined (`/language` is model reply language, not UI locale).
     * Custom agents (including shipped-id homonyms like ptc.md) are not overlaid.
     */
    getLanguage?(): Promise<string | undefined>;
}
/** gate/opt-in 未满足时的统一拒绝错误（由 acp-agent 映射为 methodNotFound） */
export declare class MainAgentNotEnabledError extends Error {
    constructor();
}
/**
 * 当前连接是否可以读取/改写该会话的 standing 主 agent。
 *
 * WorkBuddy（hostKind=unopted）一律不可见：Web `loadSession` / `renderConnection`
 * 会把 `meta.acpConnectionId` 改绑到自己，但不能因此放开 picker / set_agent。
 *
 * TUI native / 已 opt-in 的 Web 会话：磁盘上常残留上一次 Web 的
 * `acpConnectionId`（`renderConnection` 只改内存、未必 save）。新连接续接
 * 同一会话时必须放行，否则 `getAgents` 会被映射成 methodNotFound。
 *
 * 未盖章且 owner 对不上：无 gate 时 fail-closed；owner 仍是 live/remembered
 * unopted → 拒绝；owner 已不在连接表（getHostKind 回落 native）→ 视为过期
 * TUI/Web id，放行。WorkBuddy 遗留只认 rememberedUnopted / 已盖 hostKind，
 * 不会因为同进程有过 sidecar 就把所有未知 id 判成 unopted。
 */
export declare function isSessionVisibleToMainAgentRpc(session: Session | undefined, connectionId: string | undefined): boolean;
/**
 * 校验目标 session 是否属于当前 ACP 连接。
 *
 * 请求级 handler（getAgents/set_agent）不能只按“调用方连接”的 gate 放行，否则
 * opted-in 的 Web UI 连接可以读取/改写同进程 unopted WorkBuddy 会话的 standing
 * 主 agent。ACP 创建的 session 都有 meta.acpConnectionId；缺失时视为兼容旧会话，
 * 不额外拦截（避免 Web UI 对早期无 connectionId 的自身会话报 method not found）。
 */
export declare function assertSessionOwnedByConnection(session: Session, deps: MainAgentAcpDeps): void;
/**
 * set_agent / getAgents 优先用内存常驻实例（Web 续接 TUI 后 owner 已改绑），
 * 磁盘 `get()` 每次反序列化，可能仍是上一次 Web 的 acpConnectionId。
 */
export declare function resolveRuntimeSession(sessionId: string, disk: Session, deps: MainAgentAcpDeps): Session;
/**
 * 生效的默认主 agent 名（设计 v0.6 §3.6，设置页"设默认"接入展示面）。
 *
 * gate/opt-in 关闭 → 产品默认（零影响）；开启时 settings codebuddy.mainAgent.default
 * 存在且 agentManager.get() 命中 → 用配置值；否则产品默认。展示（getAgents/
 * configOptions/newSession/loadSession 的 defaultAgentName）与 run 解析链
 * （resolveMainAgentForSession Step 2.5）同源，杜绝"默认值展示/执行分叉"。
 */
export declare function resolveEffectiveDefaultAgentName(deps: MainAgentAcpDeps): Promise<string>;
/**
 * 构建 agents 目录（设计 v0.6 §3.6）。
 *
 * - 单一来源 agentManager.getAll()（agentMap 已含内置 + 自定义 + 插件）；
 * - 展示字段（description/tags/declaredModel）必须读 product config
 *   （agentManager.getAgentConfig）——getAll 返回的是 OpenAI 运行时 Agent 实例，
 *   不携带这些产品配置字段（否则内置全错归 built-in、菜单无描述）；
 * - 过滤内部编排 agent（isHiddenAgent(includeInternal=false) 语义），
 *   **默认 agent 单独放行**（DEFAULT_AGENT_TAG 会被 hidden，需保证"切回默认"有候选）；
 * - source 复用 classifyAgentSource 真值（'built-in' 带连字符）；
 * - modelId 只读显式声明（config.declaredModel），不调 getModel（避免 N 次阻塞解析）；
 * - 单 agent 解析失败记 broken，不整体失败。
 */
export declare function buildAgentDirectory(agentManager: Pick<AgentManager, 'getAllConfigs'>, options: {
    defaultAgentName: string;
    language?: string;
}): Promise<MainAgentDirectoryEntry[]>;
/**
 * 展示/目录用的轻量主 agent 名。选名走 `pickMainAgentName`（与 run 同一条链），
 * 只是存在性用 configNames，避免 chip 去等 `agentManager.get()` / MCP rebuild。
 */
export declare function resolveDisplayMainAgentName(session: Session | undefined, deps: MainAgentAcpDeps, configNames: Set<string>, defaultAgentName: string): Promise<string>;
/**
 * `_codebuddy.ai/getAgents` 处理。
 */
export declare function handleGetAgents(params: {
    sessionId?: string;
}, deps: MainAgentAcpDeps): Promise<GetAgentsResult>;
/**
 * Chip / getAgents / set_agent / 新会话盖章只认四套 shipped + 带
 * `mainAgent: true`（加载后 `main-agent-preset`）的自定义 agent。
 * 普通自定义 .md / Explore / Plan 等子代理不能当站立主 Agent。
 */
export declare function isUserSettableMainAgent(agent: Agent, defaultAgentName: string): boolean;
/**
 * 空白会话上应用 `--agent` / session/new `_meta` 指定的主 agent。
 * 只用于**新建**空白会话：任意 user-settable 名（不限于 shipped standing）。
 * 已有站立键或已有历史的会话不盖，除非 `overwriteExisting`（显式 `_meta`）。
 * TUI native 在 `stampLastUsedOnNativeSession` 里先走这里盖进程 `--agent`
 * （含 `mainAgent: true` 自定义），再盖 lastUsed。
 * 存在性只读 `getAllConfigs()`（configReady），不 `get()`，以免 session/new
 * 卡在 rebuild / MCP。
 */
export declare function applyUserSettableMainAgentIfBlank(session: Session, agentName: string | undefined, deps: MainAgentAcpDeps, options?: {
    overwriteExisting?: boolean;
}): Promise<boolean>;
/**
 * 应用主 agent 到会话（写持久键 + 镜像 + 落盘 + 模型联动）。
 *
 * set_agent 与 session/new `_meta['codebuddy.ai/agent']` 共用同一应用路径
 * （终审 P1 对齐）：写 session.meta[MAIN_AGENT_META_KEY] + 同步 agentName +
 * 显式 save + 会话级模型联动（声明模型时二次 save + reconcileThinking）。
 */
export declare function applyMainAgentToSession(session: Session, agent: Agent, deps: MainAgentAcpDeps): Promise<void>;
/**
 * 新**空白**会话在未显式选 agent 时，把 settings 默认或 lastUsed 盖成站立键。
 * WorkBuddy：isEnabled() 为 false（未 opt-in）→ 不盖章。
 * 已有 mainKey（请求带了 `_meta['codebuddy.ai/agent']`）→ 不覆盖。
 * 已有历史 → 不盖（禁止把 lastUsed 写进 resume 会话）。
 * 「设为默认」优先于 lastUsed。
 * 存在性只读 `getAllConfigs()`（configReady），不得等待 runtime agent / MCP settle。
 */
export declare function maybeStampConfiguredDefaultOnNewSession(session: Session, deps: MainAgentAcpDeps): Promise<void>;
/**
 * `session/set_agent` 处理（校验链 + 应用，设计 v0.6 §3.5/§3.7）。
 *
 * 校验顺序：会话类型（subagent/团队/后台拒绝）→ opt-in/gate → agent 存在
 * → 仅空白会话可换（agent_switch_locked 语义由错误码承载）。
 *
 * 应用：
 * 1. 写 session.meta[MAIN_AGENT_META_KEY] + 同步 session.agentName（镜像一致，@agent 语义配套）
 *    + 显式 sessionManager.save(session)（.meta.json 落盘，P0-2）；
 * 2. 模型联动（纯会话级）：无显式覆盖且 agent 显式声明 model → 写
 *    requestOptions/options.model + setOverrideModel（**不调 cliSettingsProvider.set**）；
 * 3. configChangeEvent（configId='agent'）触发 getConfigOptions 重算；
 * 4. 响应带 models/currentModelId/sessionBlank（权威刷新源）。
 */
export declare function handleSetAgent(params: {
    sessionId: string;
    agentName: string;
}, deps: MainAgentAcpDeps): Promise<SetAgentResult>;
/**
 * 是否为「用户显式选择」——只有 user 级 override 才算。
 * materialized（Web UI 装配期钉住）/ declared（Agent 声明模型）都允许被后续意图覆盖。
 */
export declare function hasUserExplicitOverride(session: Session, sessionManager: Pick<SessionManager, 'getOverrideModel' | 'getOverrideModelSource'>): boolean;
