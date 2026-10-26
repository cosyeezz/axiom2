/**
 * server 对内核的操作面：全部以具名 Effect 程序声明（E7' 试验的正身）。
 *
 * 纹理：依赖经 yield* 服务键从 R 通道获取（Effect.fn 带 span 名）；边界
 * （live-session-manager / sessions / start）用 services.ts 的 runtime 跑。
 * 可测性即卖点：单测用 @effect/vitest 的 layer() 注入假实现直接测语义，
 * 不 boot celljs 容器（见 kernel-effects.spec.ts）。
 *
 * 纪律（DI-only）：这里只声明"取哪些依赖、对它们做什么"；不引入 fiber
 * 并发原语，agent 主循环等 promise 态机器不包进 Effect——句柄取出后仍在
 * promise 世界运行。
 */
import type { Session } from '../../vendor/cbc-core/node/index.js';
import { Context, Effect } from 'effect';
import { type SessionRemoteAgentsPolicy } from '../a2a/a2a-session-source';
import type { ServerInitMetadata } from '../cli/stream-json-transformers';
import { AgentOptionError } from './errors';
import { AgentManager, AgentScanner, AgentScopedMcp, CommandManager, Cost, McpManager, Product, SessionManager, SessionTitle, Settings, SkillScanner, Telemetry, ToolPermission } from './services';
import type { QueryOptions, SessionCatalog } from './types';
declare const KernelOperationError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "KernelOperationError";
} & Readonly<A>;
/**
 * 裸 `Effect.tryPromise(fn)` 把 rejection 包成通用文案的 UnknownError
 * （"An error occurred in Effect.tryPromise"），真错藏进 cause、调用方
 * 日志只见空话（lamp 排障判例）。会浮出的调用点一律走本错误：报错点名
 * 操作、正文带原错信息、cause 保链；tagged 形让调用方可按 `_tag` 判别，
 * 不与其他 Error 在失败通道里混成一团。
 */
export declare class KernelOperationError extends KernelOperationError_base<{
    readonly operation: string;
    readonly cause: unknown;
    readonly message: string;
}> {
    constructor(operation: string, cause: unknown);
}
declare const ContextWindowOptionError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "ContextWindowOptionError";
} & Readonly<A>;
/** QueryOptions.contextWindow 不是正整数或 null。 */
export declare class ContextWindowOptionError extends ContextWindowOptionError_base<{
    readonly message: string;
    readonly value: number | null;
}> {
}
declare const SessionResourcesBusyError_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "SessionResourcesBusyError";
} & Readonly<A>;
/** 会话资源仍被后台任务占用，拒绝替换/移除会话级连接。 */
export declare class SessionResourcesBusyError extends SessionResourcesBusyError_base<{
    readonly message: string;
}> {
}
/**
 * 诊断开关的读取面：环境变量恰为 '1' 时开启。默认实现每次调用实时读进程环境
 * （与本仓 per-session env 实时读纪律一致；Effect 的 ConfigProvider.fromEnv 会在
 * 首次求值时快照 process.env，不能用）。测试可用 Context.Reference 覆盖。
 */
export declare const DebugFlags: Context.Reference<{
    readonly isEnabled: (name: string) => boolean;
}>;
/**
 * init 帧清单装配（M1 补全）：逐源 best-effort——单源失败 orElseSucceed 回退
 * 桩值，绝不阻断 wiring；走 metadata-only 道（声明面 tools / 配置面 mcp
 * names / 命令注册表 / currentModelId），不等 MCP settle。
 */
export declare const gatherInitMetadata: Effect.Effect<ServerInitMetadata, never, AgentManager | CommandManager | McpManager | Product>;
/** Executable catalog in the same Product/filesystem scope as this session. */
export declare const gatherSessionCatalog: (session: Session) => Effect.Effect<SessionCatalog, KernelOperationError, import("./services").ComponentResolver | AgentManager | Product | Settings>;
/** 遥测告警（早 boot 期服务缺席由边界 try/catch 兜住）。 */
export declare const warnTelemetry: (message: string) => Effect.Effect<void, never, Telemetry>;
/** 工具权限上下文播种（settings allow/deny/ask 规则入席）。 */
export declare const seedToolPermissionContext: (session: Session) => Effect.Effect<void, KernelOperationError, import("./services").ComponentResolver | ToolPermission>;
/** 会话级 MCP 挂载（借 sub-agent 隔离通道，agentName 固定 'session'）。 */
export declare const setupSessionScopedMcp: (input: {
    session: Session;
    agentName: string;
    specs: Array<Record<string, unknown>>;
    deferEnvironmentServers?: boolean;
}) => Effect.Effect<void, KernelOperationError, AgentScopedMcp>;
/**
 * 会话级 MCP 中标了 `connection_origin: 'environment'` 的 stdio server：在本会话的沙箱
 * 执行上下文里启动。同步取服务、返回 promise 由调用方等待，启动在调用方的 ALS 里进行。
 */
export declare const startSessionEnvironmentMcp: (session: Session, signal?: AbortSignal | undefined) => Effect.Effect<Promise<void>, never, AgentScopedMcp>;
/** 会话级 MCP 拆除（借用的全局 server 由 scoped manager 契约保留）。 */
export declare const cleanupSessionScopedMcp: (sessionId: string) => Effect.Effect<void, KernelOperationError, AgentScopedMcp>;
/** W2 读面：强制 volatile-provider 层对注入 fs 重建（跳过 cloud/models 链）。 */
export declare const resyncVolatileProviders: Effect.Effect<void, KernelOperationError, Product>;
/** 会话驻留开始：这次驻留自己的 shell snapshot，如同 CE 子进程启动时生成自己的。 */
export declare const warmupSessionShellSnapshot: (sessionId: string) => Effect.Effect<void, KernelOperationError, import("./services").ComponentResolver>;
/** 会话驻留结束：删除这次驻留的 shell snapshot。 */
export declare const releaseSessionShellSnapshot: (sessionId: string) => Effect.Effect<void, KernelOperationError, import("./services").ComponentResolver>;
/** 在 runtime 释放前排空后台刷新并撤销延迟任务，避免关停后访问反向桥。 */
export declare const prepareServerShutdown: Effect.Effect<void, never, import("./services").ComponentResolver>;
/** result 帧的 api 时长统计（同步取数走 Effect.try：面缺席进 typed 错误道）。 */
export declare const costApiDurationMs: Effect.Effect<number, import("effect/Cause").UnknownError, Cost>;
/** shell 层 sandbox 接缝的当前会话解析。 */
export declare const getCurrentSession: Effect.Effect<Session, never, SessionManager>;
/** 进程内 server 无 TTY；由 start({ env }) 显式开启 AI 会话标题。 */
export declare const enableSessionTitles: Effect.Effect<void, never, SessionTitle>;
/** 有界等待当前会话的标题生成任务，避免阻塞 query 终态。 */
export declare const waitForPendingSessionTitle: (sessionId: string, timeoutMs?: any) => Effect.Effect<void, never, SessionTitle>;
/**
 * 会话档技能扫描（形态 A）：在会话 rootScope 内执行，ambient dataFs 因此
 * 解析到该会话的 fs——复用原 provider 的项目、用户及其他技能源扫描，
 * 与进程档扫描同一路径约定（同树双面纪律对会话档同样适用）。
 * 扫描同样读取内置技能目录，按本会话 Product 的 disabledBuiltinSkills 过滤，
 * 与进程档在 ProductManager 中的过滤一致。
 */
export declare const scanSessionSkills: (session: Session) => Effect.Effect<import("@genie/product").Skill[], KernelOperationError, import("./services").ComponentResolver | Product | SkillScanner>;
/** Reuse the CLI agent parser under this session's cwd and mounted filesystem. */
export declare const scanSessionAgents: (session: Session) => Effect.Effect<import("@genie/product").Agent[], KernelOperationError, import("./services").ComponentResolver | AgentScanner>;
/**
 * 会话档命令扫描（形态 A，与 scanSessionSkills 同构）：会话 rootScope 内执行，
 * ambient dataFs 解析到该会话的 fs；项目覆盖用户命令，解析和优先级与进程档
 * provider 共用 command-file-scanner。
 */
export declare const scanSessionCommands: (session: Session) => Effect.Effect<import("@genie/product").Command[], KernelOperationError, import("./services").ComponentResolver>;
/**
 * 会话档专家插件全组件解析（#108461，与 scanSessionSkills 同构）：会话 rootScope
 * 内执行，ambient dataFs + currentSessionSettings 因此解析到该会话——用**标准加载器**
 * loadPluginComponents 全量加载已启用（settings.enabledPlugins）会话档插件，聚合出
 * persona（settings.agent instructions）/MCP/skills/commands，供各会话车道消费。
 */
export declare const scanSessionPluginComponents: (session: Session, pluginRoots: readonly import("./types").SessionPluginRoot[] | undefined) => Effect.Effect<import("../agent/session-plugin-agent-resolver").SessionPluginComponents, KernelOperationError, import("./services").ComponentResolver>;
/**
 * session-agent-view 预热（激活期构建一次）：会话档输入（技能/命令/工具白名单）
 * 就位后为会话当前主 agent 构建会话视图，首轮派发直接命中缓存。无会话输入时
 * 是 no-op。
 */
export declare const prepareSessionAgentView: (session: Session) => Effect.Effect<void, KernelOperationError, AgentManager>;
export declare const startSessionCapabilityPreparation: (session: Session) => Effect.Effect<void, never, import("./services").ComponentResolver>;
export declare const invalidateSessionCapabilityPreparation: (session: Session, reason: string) => Effect.Effect<void, never, import("./services").ComponentResolver>;
/**
 * QueryOptions.agent → 会话主 agent 席位（内核 mention 席位 session.agentName，
 * resolveMainAgentForSession 逐 run 解析、gate 无关）。未知名 fail-loud 拒绝
 * 本 query——静默回落默认 agent 即 expert 语义无声丢弃（lamp 事故同类失败形；
 * 会话档插件 agent 的装载缺口另见 issue #108461）。
 */
export declare const applySessionAgent: (session: Session, agentName: string) => Effect.Effect<undefined, AgentOptionError, AgentManager>;
/** Use the same overlay transition as the CLI host; no separate worker lifecycle. */
export declare const applySessionMultitask: (session: Session, enabled: boolean) => Effect.Effect<undefined, AgentOptionError | KernelOperationError, never>;
/**
 * QueryOptions.remoteAgentsUrl → 会话级出站 A2A 发现源席位（a2a-session-source
 * seam）。纯赋值：目录拉取按需惰性（首轮 prewait / 工具执行的 readiness 单飞，
 * 按源共享），此处不发起 discovery。`''` = 本会话显式无源（A2A 关）。
 */
export declare const applySessionRemoteAgentsUrl: (session: Session, url: string) => Effect.Effect<void, never, never>;
/**
 * QueryOptions.remoteAgentsTrusted / remoteAgentsEnabled → 会话级 A2A 策略席位
 * （a2a-session-source seam）。纯赋值，整体置换；判定在 a2a-gate 读取。
 */
export declare const applySessionRemoteAgentsPolicy: (session: Session, policy: SessionRemoteAgentsPolicy) => Effect.Effect<void, never, never>;
/**
 * 钝化收尾的内核在存注册释放（soak 残留内核半边）：resultSubject 订阅、
 * idle 定时器、override 席位、管道注册表等 7 类强引用——AgentTask.cleanup
 * 同 API（releaseInMemory，内核为长活进程 OOM 修复而设，主会话路径此前
 * 从未接）。durable 面不动：SessionStore 是真源，重激活经 open() 水合重建。
 */
export declare const releaseKernelSession: (sessionId: string) => Effect.Effect<void, never, SessionManager>;
/**
 * thinking / effort / maxThinkingTokens → 会话 override 席位（与 /effort、
 * ACP thought_level 同座）。per-query 提供即按维度置换，省略保持上次；
 * disabled 显式关（内核同时清空 effort，防"假关闭"残留）；adaptive 清除
 * 固定预算。
 */
export declare const applyThinkingOverride: (sessionId: string, options: Pick<QueryOptions, "thinking" | "effort" | "maxThinkingTokens">) => Effect.Effect<void, never, SessionManager>;
/** The same session override used by ACP's context_window selector. */
export declare const applyContextWindowOverride: (sessionId: string, value: number | null) => Effect.Effect<undefined, ContextWindowOptionError, SessionManager>;
export {};
