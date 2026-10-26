/**
 * Effect v4 DI 层（E7'）：server 内部依赖获取的唯一门面。
 *
 * 目标：server/* 不感知 celljs——容器只存在于 boot.ts（边界）。服务以
 * Context.Service 键声明（键本身是 Effect，程序里 yield* 即得），celljs
 * 容器经一层 Layer.sync 桥接，ManagedRuntime 在 boot 后装配、stop 时
 * dispose。键名即服务名；celljs 协议 token 只在本文件出现，一律 *Token
 * 别名（消歧长在桥上，不向消费方泄露）。
 *
 * 纪律（DI-only，effect-v4-reserve.md §2 的卡点判据因此不被激活）：Effect
 * 承载 server 层的编排与依赖；运行路径零 fiber 并发原语（无 Deferred /
 * Queue / Semaphore），会话身份继续走 ALS——fiber 唤醒 fiber 的串味场景
 * 构造性不存在。版本由 workspace effect4 catalog 精确 pin，升级须逐条读 changeset。
 */
import type { AgentRunOrigin, AgentServiceRunControlOptions } from '../../vendor/cbc-core/node/index.js';
import { AgentManager as AgentManagerToken, Session, SessionHookManager as SessionHookManagerToken, SessionManager as SessionManagerToken, SessionRunStateMachine as SessionRunStateMachineToken, SteerInputBuffer as SteerInputBufferToken } from '../../vendor/cbc-core/node/index.js';
import { type Agent, ProductManager as ProductManagerToken, type Skill } from '@genie/product';
import { Context, Effect, type Fiber, Layer } from 'effect';
import { SensitiveUserInputReview as SensitiveUserInputReviewToken } from '../sensitive-content/sensitive-content-protocol';
import { SettingsManager as SettingsManagerToken } from '../settings/settings-protocol';
import type { ManualCompactions } from './compaction';
import type { NativeServices } from './native-layers';
export interface AgentManagerApi {
    getDefaultAgentName: AgentManagerToken['getDefaultAgentName'];
    getCommands: AgentManagerToken['getCommands'];
    getInitializeMetadata(): Promise<{
        defaultAgentName: string;
        currentModelId?: string;
    }>;
    getAgentConfig(name: string): Promise<{
        tools?: string[];
    } | undefined>;
    /** 注册态解析（含 launch 拒绝重抛）——applySessionAgent 的派发同源校验谓词。 */
    get(agentName: string): Promise<unknown | undefined>;
    prepareSessionAgentView(session: Session): Promise<void>;
    /** Default agent instructions/tools — the turn-end usageByCategory snapshot reads these. */
    getDefault(): Promise<{
        name: string;
        instructions?: unknown;
        tools?: unknown;
    }>;
}
export interface CommandManagerApi {
    getAll(): Promise<Array<{
        name: string;
    }>>;
}
export interface McpManagerApi {
    list(): Promise<Record<string, Record<string, unknown>>>;
}
export interface ProductApi {
    waitConfiguration: ProductManagerToken['waitConfiguration'];
    getEndpoint(): string;
    syncVolatileProviders(force?: boolean): Promise<void>;
}
export interface ToolPermissionApi {
    initializeContext(session: Session): Promise<void>;
}
export interface AgentScopedMcpApi {
    setupForSubAgent(input: {
        session: Session;
        agentName: string;
        specs: Array<Record<string, unknown>>;
        deferEnvironmentServers?: boolean;
        scope?: import('../mcp/mcp-protocol').McpScope;
    }): Promise<void>;
    startEnvironmentServers(session: Session, signal?: AbortSignal): Promise<void>;
    cleanup(sessionId: string): Promise<void>;
}
export interface TelemetryApi {
    warn(message: string): void;
}
export interface CostApi {
    getAllStatistics(): {
        apiDuration: number;
    };
}
export interface AgentRunnerApi {
    runDefault(input: unknown, opts: AgentServiceRunControlOptions & {
        context: Session;
        signal?: AbortSignal;
        maxTurns?: number;
        /**
         * Provenance for fresh user turns. Consumed by
         * HumanInputProvenanceAgentRunInterceptor → team resume intent →
         * AgentRunScope human lease (gates SendMessage's origin check), so
         * this narrow consumption face must carry it through.
         */
        inputOrigin?: AgentRunOrigin;
    }): Promise<void>;
}
export interface SkillScannerApi {
    scanTree(baseDir: string, source?: string): Promise<Skill[]>;
    scanWorkspace(cwd: string): Promise<Skill[]>;
}
export interface AgentScannerApi {
    scanWorkspace(cwd: string): Promise<Agent[]>;
}
/** SessionManager 的 server 消费面（E7' 窄接口初衷补完；宽接口经委托器不可行）。 */
export interface SessionManagerApi {
    getCurrent: SessionManagerToken['getCurrent'];
    get: SessionManagerToken['get'];
    create: SessionManagerToken['create'];
    run: SessionManagerToken['run'];
    initRunResultHandler: SessionManagerToken['initRunResultHandler'];
    releaseInMemory: SessionManagerToken['releaseInMemory'];
    getOverrideThinking: SessionManagerToken['getOverrideThinking'];
    setOverrideThinking: SessionManagerToken['setOverrideThinking'];
    setOverrideContextWindow: SessionManagerToken['setOverrideContextWindow'];
    flushHistory: SessionManagerToken['flushHistory'];
    appendHistoryFact: SessionManagerToken['appendHistoryFact'];
    /** 轮次收尾补发的助手消息要走这条路：既进 history/store，也发 combineSubject。 */
    addHistory: SessionManagerToken['addHistory'];
    emitSessionStart: SessionManagerToken['emitSessionStart'];
}
export interface SessionTitleApi {
    getPendingTitlePromise(sessionId: string): Promise<void> | undefined;
    setForceEnabled(enabled: boolean): void;
}
declare const AgentManager_base: Context.ServiceClass<AgentManager, "server/AgentManager", AgentManagerApi>;
export declare class AgentManager extends AgentManager_base {
}
declare const Compactions_base: Context.ServiceClass<Compactions, "server/Compactions", ManualCompactions>;
export declare class Compactions extends Compactions_base {
}
declare const SteerBuffer_base: Context.ServiceClass<SteerBuffer, "server/SteerBuffer", SteerInputBufferToken>;
export declare class SteerBuffer extends SteerBuffer_base {
}
declare const RunState_base: Context.ServiceClass<RunState, "server/RunState", Pick<SessionRunStateMachineToken, "getSnapshot">>;
export declare class RunState extends RunState_base {
}
declare const SessionHooks_base: Context.ServiceClass<SessionHooks, "server/SessionHooks", Pick<SessionHookManagerToken, "executeUserPromptSubmitHooks" | "executeSessionEndHooks">>;
export declare class SessionHooks extends SessionHooks_base {
}
declare const UserInputReview_base: Context.ServiceClass<UserInputReview, "server/UserInputReview", SensitiveUserInputReviewToken>;
export declare class UserInputReview extends UserInputReview_base {
}
declare const CommandManager_base: Context.ServiceClass<CommandManager, "server/CommandManager", CommandManagerApi>;
export declare class CommandManager extends CommandManager_base {
}
declare const McpManager_base: Context.ServiceClass<McpManager, "server/McpManager", McpManagerApi>;
export declare class McpManager extends McpManager_base {
}
declare const Product_base: Context.ServiceClass<Product, "server/Product", ProductApi>;
export declare class Product extends Product_base {
}
declare const Settings_base: Context.ServiceClass<Settings, "server/Settings", Pick<SettingsManagerToken, "get" | "clearCache">>;
export declare class Settings extends Settings_base {
}
declare const ToolPermission_base: Context.ServiceClass<ToolPermission, "server/ToolPermission", ToolPermissionApi>;
export declare class ToolPermission extends ToolPermission_base {
}
declare const AgentScopedMcp_base: Context.ServiceClass<AgentScopedMcp, "server/AgentScopedMcp", AgentScopedMcpApi>;
export declare class AgentScopedMcp extends AgentScopedMcp_base {
}
declare const SessionManager_base: Context.ServiceClass<SessionManager, "server/SessionManager", SessionManagerApi>;
export declare class SessionManager extends SessionManager_base {
}
declare const Telemetry_base: Context.ServiceClass<Telemetry, "server/Telemetry", TelemetryApi>;
export declare class Telemetry extends Telemetry_base {
}
declare const Cost_base: Context.ServiceClass<Cost, "server/Cost", CostApi>;
export declare class Cost extends Cost_base {
}
declare const AgentService_base: Context.ServiceClass<AgentService, "server/AgentService", AgentRunnerApi>;
export declare class AgentService extends AgentService_base {
}
declare const SkillScanner_base: Context.ServiceClass<SkillScanner, "server/SkillScanner", SkillScannerApi>;
export declare class SkillScanner extends SkillScanner_base {
}
declare const AgentScanner_base: Context.ServiceClass<AgentScanner, "server/AgentScanner", AgentScannerApi>;
export declare class AgentScanner extends AgentScanner_base {
}
declare const SessionTitle_base: Context.ServiceClass<SessionTitle, "server/SessionTitle", SessionTitleApi>;
export declare class SessionTitle extends SessionTitle_base {
}
type Resolve = <T>(token: unknown) => T;
type ResolveAll = <T>(token: unknown) => T[];
/**
 * celljs Provider 的结构面（@AutowiredProvider 注入物）：惰性收集 + 首访
 * 快照 + ComponentFilterRegistry 过滤 + priority/order 排序。桥转发容器自产
 * 的 ContainerBasedProvider——四条语义免费继承，不做替身实现（漂移风险）。
 */
export interface ProviderLike<T> {
    get(recursive?: boolean): T[];
    sortSync(getPriority?: unknown, recursive?: boolean): T[];
    sort(getPriority?: unknown, recursive?: boolean): Promise<T[]>;
}
export interface ComponentResolverApi {
    get<T>(token: unknown): T;
    getAll<T>(token: unknown): T[];
    createProvider<T>(token: unknown): ProviderLike<T>;
}
declare const ComponentResolver_base: Context.ServiceClass<ComponentResolver, "server/ComponentResolver", ComponentResolverApi>;
export declare class ComponentResolver extends ComponentResolver_base {
}
type CreateProvider = <T>(token: unknown) => ProviderLike<T>;
declare function makeKernelLayer(resolve: Resolve, resolveAll?: ResolveAll, createProvider?: CreateProvider): Layer.Layer<ComponentResolver | AgentManager | CommandManager | McpManager | Product | Settings | ToolPermission | AgentScopedMcp | SessionManager | SteerBuffer | RunState | SessionHooks | UserInputReview | Telemetry | Cost | AgentService | SkillScanner | AgentScanner | SessionTitle, never, never>;
export type KernelServices = Layer.Success<ReturnType<typeof makeKernelLayer>>;
/** 运行时全量服务面 = celljs 桥面 + 原生注册面（step-3 试点起）。 */
type ServerServices = KernelServices | NativeServices;
export declare function component<T>(token: abstract new (...args: never[]) => T): Effect.Effect<T, never, ComponentResolver>;
export declare function component<T>(token: unknown): Effect.Effect<T, never, ComponentResolver>;
export declare function components<T>(token: unknown): Effect.Effect<readonly T[], never, ComponentResolver>;
/** @AutowiredProvider 依赖的桥形：容器自产 Provider 直转（语义四件套免费继承）。 */
export declare function componentProvider<T>(token: unknown): Effect.Effect<ProviderLike<T>, never, ComponentResolver>;
/** @Optional 依赖的桥形：缺绑定回 undefined（celljs @Optional 同语义）。 */
export declare function componentOptional<T>(token: unknown): Effect.Effect<T | undefined, never, ComponentResolver>;
/** 运行时是否已 bind——时间读点的兜底判据（boot 前 subscribe 兼容道）。 */
export declare function isRuntimeBound(): boolean;
/**
 * boot 完成后把 celljs 容器实例装配进 Effect 服务运行时（幂等）；resolve 即
 * 容器边界——celljs 不再向外泄露。`testLayer` 为测试专用第二参（DST：并入
 * TestClock 等测试服务层，生产调用方不传）。
 */
export declare function bindServerServices(resolve: Resolve, testLayer?: Layer.Layer<never>, resolveAll?: ResolveAll, options?: {
    skipGenerated?: boolean;
    createProvider?: CreateProvider;
    deferPostConstructs?: boolean;
}): Promise<void>;
/** stop 收尾：dispose 跑 Layer finalizer 并释放 runtime 席位。 */
export declare function releaseServerServices(): Promise<void>;
/**
 * 边界跑一个依赖内核服务的 Effect 程序（ManagedRuntime.runPromise）。
 * server 层逻辑本身用 Effect 写、依赖走 R 通道；这两个 runner 只出现在
 * 边界五类：verb 入口 / 内核回调 / sync 投递告警 / 跨 run 共享在途 open
 * 的 promise 席位 / ALS 根作用域建立缝。
 */
export declare function runServerEffect<A, E>(program: Effect.Effect<A, E, ServerServices>): Promise<A>;
/** 同步边界（sync 调用栈里的内核回调与投递告警）。 */
export declare function runServerEffectSync<A, E>(program: Effect.Effect<A, E, ServerServices>): A;
/**
 * 常驻 fiber 边界（top-level 任务/投递机器：会话运行队列 worker、listener
 * drain）。纪律（E7'' 修正）：top-level 允许 Effect 并发原语——每个运行单元
 * 在 executeQuery 内显式重建 ALS 根作用域、投递回调不消费 ALS，§2 的
 * fiber 唤醒继承串味在此构造性无害；内核 run 路径继续 promise。
 * runtime.dispose()（stop 收尾）中断全部常驻 fiber。
 */
export declare function runServerFork<A, E>(program: Effect.Effect<A, E, ServerServices>): Fiber.Fiber<A, E>;
export {};
