import { AgentNames, Session } from '../../vendor/cbc-core/node/index.js';
export { MAIN_AGENT_META_KEY, standingMainAgentName } from './standing-main-agent';
/** First-seen ACP host kind. Survives connectionId rebind on load/reconnect. */
export declare const MAIN_AGENT_HOST_KIND_KEY = "codebuddy.ai/hostKind";
/**
 * 读名只留三套对外入口：
 * - `standingMainAgentName`：持久身份（只读 meta 键）
 * - `constraintMainAgentName`：本轮工具 / Plan / REPL 约束名（子代理、leftover、gate）
 * - `codeModeSpecOf`：PTC / 极简工具契约，由 constraint 派生
 * 选 Agent 实例走 `pickMainAgentName`（resolver）。不要再加第四套 leftover 读法。
 */
interface SessionAgentRef {
    meta?: Record<string, unknown>;
    agentName?: string;
}
type StandingConstraintGate = (session?: SessionAgentRef) => boolean;
/**
 * Production binds this from MainAgentGateProvider so leftover standing keys
 * stop mutating tools/REPL/Plan when the kill switch or unopted host is off.
 * Unbound (unit tests / no container) keeps name matching so specs stay local.
 */
export declare function bindStandingConstraintGate(gate?: StandingConstraintGate): void;
export declare function isStandingConstraintActive(session?: SessionAgentRef): boolean;
/**
 * 空白会话判定（设计 v0.6 §3.5，持久可判据）。
 *
 * 会话历史中不存在"主 agent 产出"的 assistant 消息即空白：
 * - type==='message' 且 role==='assistant'
 * - providerData.agent !== COMPACT（排除 compact 摘要项）
 * - 且 !isSubAgent / !isCompactInternal / !isSummary（input-item-processors 的持久 stamp 字段）
 *
 * 边界（文档化）：refusal/内容过滤/无效 tool call 失败轮会产生非 compact 的
 * assistant 终止消息 → 判定为非空白（保守锁定，符合"会话已开始"语义）。
 * 不依赖 runState（不持久化，重启恒 IDLE）。
 */
export declare function isSessionBlank(session: Session | undefined): boolean;
/**
 * `session.agentName` / `meta.agentName` 上的 ptc/minimal/create 是 telemetry
 * 或进程 `--agent` leftover，不是站立切换。
 *
 * 只在它与已落盘的 mainKey 一致时才认（stamp / set_agent / 空白会话 persist）。
 * 总闸关闭（WorkBuddy）一律忽略 shipped leftover；Explore / 自定义 @agent 不是
 * shipped，调用方继续走 Step 1。
 *
 * 与 `constraintMainAgentName` 对齐：无站立键时不认 leftover agentName。
 */
export declare function isIgnorableShippedAgentLeftover(session: SessionAgentRef | undefined, agentName: string | undefined, gateEnabled: boolean): boolean;
/**
 * 本轮 run 的 agent 名。OpenAI `RunContext` 没有 agent 字段，isEnabled / 调用方
 * 可以挂在 context.agent 上；没有就让 codeModeSpecOf 只认站立键。
 * 参数用 unknown：与 `RunContext<Session>` 没有交集，写成 `{ agent? }` 会 TS2559。
 */
export declare function runAgentNameFromRunContext(context?: unknown): string | undefined;
/**
 * Code Mode（PTC / Minimal）的完整工具面契约。
 *
 * **这是「某个会话是不是 Code Mode、能调什么」的唯一事实源。** 四个消费点
 * （LLM 工具列表门控、REPL 总闸、沙箱目录采集、沙箱执行放行）必须全部经由
 * 本函数，不得各自重写等价判据 —— 历史教训：`agent-manager` 按「直连白名单」
 * 判定、`repl-tool` 只认 PTC，两处与 `tools: ['REPL']` 不同步，直接导致
 * Minimal 模式下 REPL 被自己的门过滤掉、模型一个工具都拿不到。
 */
export interface CodeModeSpec {
    /** 站立模式名，用于日志与错误文案。 */
    readonly mode: AgentNames.PTC | AgentNames.MINIMAL;
    /** 模型面可直连的工具（两个模式都只有 REPL）。 */
    readonly directTools: readonly string[];
    /**
     * REPL 沙箱内可见 **且**可调用的工具白名单。
     * `undefined` = 不做模式级收窄（PTC 全量开放），仍受 session `--tools`、
     * `--disallowed-tools`、deny 规则与 repl_expose 约束。
     */
    readonly sandboxTools?: readonly string[];
    /**
     * 沙箱内是否允许 MCP 工具。与 `sandboxTools` 白名单正交：白名单只约束内置
     * 工具；`mcp__` 前缀走本开关（见 `isCodeModeSandboxTool` / `isCodeModeMcpOpen`）。
     * PTC 为 true（并豁免 `repl_expose`）；极简为 false。
     */
    readonly allowMcpInSandbox: boolean;
    /**
     * 沙箱工具描述覆盖：产品模板的措辞可能与本模式的工具面矛盾
     * （Bash/Edit 模板教模型「先 Read」，而极简没有 Read）。
     */
    readonly toolDescriptionOverrides?: Readonly<Record<string, string>>;
    /** 委托 overlay 收窄后的契约：沙箱只剩委托白名单。 */
    readonly delegate?: boolean;
}
/**
 * 解析当前会话的 Code Mode 契约；非 Code Mode（cli / create / 自定义 agent）
 * 返回 `undefined`，调用方走原生工具面。
 *
 * 唯一派生自 `constraintMainAgentName`（站立键优先、leftover 忽略、gate 关闭失效），
 * 所以 WorkBuddy 未 opt-in 的会话恒返回 undefined。
 */
export declare function codeModeSpecOf(session?: SessionAgentRef, runAgentName?: string, gateActive?: boolean): CodeModeSpec | undefined;
/**
 * REPL（Code Mode）是否对该会话开启：`CODEBUDDY_REPL_ENABLED` 显式开关优先，否则看是否处于
 * Code Mode。REPLTool（isEnabled / 骨架渲染）与 AgentManager（首轮 MCP prewait 判定）共用。
 *
 * 放在 agent 层而不是 tools/repl：AgentManager 不能依赖 REPL 目录 —— server 产物会把它
 * 整个置空，从那里导入时首轮 MCP prewait 每次都抛错、被静默跳过。
 */
export declare function isReplEnabled(agentName?: string, session?: SessionAgentRef): boolean;
/** 该工具是否允许出现在模型面（Code Mode 只放行 REPL）。 */
export declare function isCodeModeDirectTool(spec: CodeModeSpec | undefined, toolName: string): boolean;
/** Code Mode 沙箱是否对 MCP 开放（站立 PTC 是，极简 / PTC overlay 否）。 */
export declare function isCodeModeMcpOpen(spec: CodeModeSpec | undefined): boolean;
/** 收窄沙箱（Minimal / PTC overlay）：注入层不得再教白名单外的工具。原生 / 站立 PTC 为 false。 */
export declare function isNarrowCodeMode(spec: CodeModeSpec | undefined): boolean;
/**
 * 抑制 MCP 能力提示（MCP UI 等）。仅收窄且关 MCP 时为 true。
 * 原生 cli（spec 空）和 PTC 都要放行 MCP UI。
 */
export declare function codeModeHidesMcpHints(spec: CodeModeSpec | undefined): boolean;
/**
 * 该工具是否允许在 REPL 沙箱内被调用。
 * `sandboxTools` 缺省表示不收窄内置面；`mcp__` 前缀只看 `allowMcpInSandbox`。
 */
export declare function isCodeModeSandboxTool(spec: CodeModeSpec | undefined, toolName: string): boolean;
/** 沙箱目录里该工具的描述：模式覆盖优先，否则用工具自带描述。 */
export declare function codeModeToolDescription(spec: CodeModeSpec | undefined, toolName: string, fallback: string | undefined): string;
/** SDK / ACP 脱敏后的「工具不存在」文案里解析工具名。 */
export declare function parseUnknownDirectToolName(message: string): string | undefined;
/** 用可信 canonical 定逻辑 namespace；裸名 MCP 只采用物理 owner。 */
export declare function mcpSandboxCallName(canonical: string, owner?: string, rawToolName?: string): string | undefined;
/**
 * 模型在 Code Mode 把沙箱工具当对话层直连调用时的纠正文案。
 *
 * 不能说「工具不存在」：PTC 下 Bash/Glob/SendMessage 都在 REPL 里。
 * 也不能指路 DeferExecuteTool：那也不是直连工具，会再失败一轮。
 *
 * `sandboxCallName` 是 REPL 里可直接调用的准确名（见 {@link mcpSandboxCallName}）；
 * 只有可信 DeferredToolInfo 能给出 MCP 逻辑 namespace；未知 MCP 不提供猜测写法。
 */
export declare function codeModeDirectCallGuidance(spec: CodeModeSpec, toolName: string, sandboxCallName?: string): string;
/**
 * Code Mode 会话上的 unknown-tool SDK 错误 → REPL 引导；非 Code Mode 返回 undefined。
 */
export declare function rewriteUnknownToolForCodeMode(session: SessionAgentRef | undefined, message: string, runAgentName?: string): string | undefined;
/**
 * 本轮工具 / Plan / REPL 约束名。会话身份只认这一处。
 *
 * - dedicated 子代理（Explore 等）用自己的 run 名，不吃父站立键
 * - gate 关：丢掉 shipped leftover / 磁盘站立键（WorkBuddy 走原生 cli）
 * - gate 开：站立键优先；无站立键只认本轮显式 run，不认 telemetry leftover
 */
export declare function constraintMainAgentName(session?: SessionAgentRef, runAgentName?: string, gateActive?: boolean): string | undefined;
/**
 * REPL 沙箱目录 / overlay / MCP 白名单用的 agent 名。
 *
 * Code Mode（PTC / Minimal）返回 `undefined`：沙箱必须按完整 cli 工具集
 * 计算 allowed tools。按 ptc/minimal 自己的直连白名单（只有 REPL）去
 * `getAllowedToolsForAgent` 会把 Bash/Edit/Skill 全部滤掉。创造同样回
 * `undefined`（下面 `CREATE` 分支）。极简的收窄由 `sandboxTools` 负责。
 */
export declare function sandboxCatalogAgentName(session?: SessionAgentRef, runAgentName?: string, gateActive?: boolean): string | undefined;
/**
 * 极简模式门控：约束名是 `minimal`。WorkBuddy 默认 `cli`，不会进这条。
 */
export declare function isMinimalStandingAgent(session?: SessionAgentRef, runAgentName?: string, gateActive?: boolean): boolean;
/**
 * 创造模式门控：约束名是 `create`。WorkBuddy 默认 `cli`，不会进这条。
 */
export declare function isCreateStandingAgent(session?: SessionAgentRef, runAgentName?: string, gateActive?: boolean): boolean;
/**
 * PTC / Code Mode 门控：约束名是 `ptc`。WorkBuddy 默认 `cli`，不会进这条；
 * REPL 不得改成进程级默认开。
 */
export declare function isPtcStandingAgent(session?: SessionAgentRef, runAgentName?: string, gateActive?: boolean): boolean;
/**
 * set_agent 在 ACP 请求里常常盖不到 run 用的那份内存 session：
 * getCurrent() 在 ALS 外会抛，sessionSubject 可能是 TUI 另一份，于是 handler
 * 只改了磁盘反序列化副本。run 仍拿未盖章的 live 实例 → 偶发第一轮走 cli。
 * 把站立键抄到同 id 的 live 引用上。
 */
export declare function mirrorMainAgentOntoLiveSessions(stamped: Session, live: ReadonlyArray<Session | undefined>): void;
/**
 * 把站立键写进 session.meta。set_agent / --agent / 首次 persist 共用，避免三处各写一份。
 */
export declare function writeStandingMainAgentKey(session: Session, name: string, options?: {
    setAgentName?: 'always' | 'if-missing';
}): void;
/**
 * 空白新会话首次命中配置默认后，把站立键落盘。
 * 否则第一轮用 ptc、第二轮（已非空白、无 mainKey）会掉回产品默认。
 * 仅在已有 mainKey 缺失且解析结果不是产品默认时写入；不覆盖 @agent 镜像。
 */
export declare function maybePersistStandingMainAgent(session: Session | undefined, agentName: string, productDefault: string, save: (session: Session) => Promise<void>): Promise<boolean>;
/**
 * Native CLI / 新建智能体 first POST 上的 `--agent`。
 *
 * RequestBuilder 把 commander opts 摊进 `/internal/agent` body。ACP 请求带
 * `acp:true`，站立键改在 opt-in 之后盖（WorkBuddy 未声明能力位则不盖）。
 */
export declare function nativeCliStandingAgentName(body: {
    acp?: boolean;
    agent?: unknown;
}): string | undefined;
/**
 * CLI `--agent ptc|minimal|create` 只在**新建空白会话**上盖站立键。
 * 会话一旦有站立键或已有历史，进程 `--agent` 不得覆盖。
 * 自定义 @agent 不盖。
 *
 * 与 ACP `session/set_agent` 同一持久键。不走 applySettingsAgent 叠到 cli：
 * 叠上去会改工具面、不改身份，Code Mode / 目录 chip 仍显示标准。
 *
 * `--agent cli` 也要盖站立键：cli 不是 shipped standing，不盖的话空白会话会
 * 继续吃 lastUsed（ptc），再被 maybePersistStandingMainAgent 写进 settings。
 */
export declare function stampShippedStandingFromCliAgent(session: Session | undefined, input: {
    cliAgentName: string | undefined;
    productDefault: string;
    gateEnabled: boolean;
    save: (session: Session) => Promise<void>;
}): Promise<boolean>;
