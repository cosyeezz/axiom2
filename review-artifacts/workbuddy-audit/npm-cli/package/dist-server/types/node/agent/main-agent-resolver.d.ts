import { Session } from '../../vendor/cbc-core/node/index.js';
import { SettingsManager } from '../settings/settings-protocol';
import { type MainAgentHostKind, type MainAgentPolicy } from './main-agent-policy';
import { Agent } from '../../vendor/cbc-shared/node/index.js';
export { MAIN_AGENT_HOST_KIND_KEY, MAIN_AGENT_META_KEY } from './main-agent-session';
/** settings 中主 agent 命名空间的顶层键 */
export declare const CODEBUDDY_SETTINGS_KEY = "codebuddy";
/** settings 总闸（不含宿主）。测试与旧调用方仍走这一层。 */
export declare function isMainAgentSettingsEnabled(codebuddy: unknown): boolean;
/**
 * 进程级 gate 缓存（run 层，设计 v0.6 §3.3）。
 *
 * `codebuddy.mainAgent.enabled` 的同步布尔快照：resolveAgentForSession 是
 * 全局热点（每个 run 都走），不能每轮做 async settings IO。参照
 * HostCapabilityProvider 的 @Component 单例范式：initialize/配置变更时
 * refresh 一次，热点路径零 await 短路。
 */
export declare class MainAgentGateProvider {
    private policy;
    /** TUI / headless 保持 native；ACP initialize 按 connectionId 记录 opted-in/unopted。 */
    private readonly hostKinds;
    /** WorkBuddy 断开后仍按 unopted 认遗留 connectionId，避免 fail-open 成 native。 */
    private readonly rememberedUnopted;
    /** 长寿命 --serve 上 sidecar 反复换 id 时封顶，按插入序淘汰最旧的。 */
    private static readonly REMEMBERED_UNOPTED_LIMIT;
    /** 非 ACP 会话（无 acpConnectionId）的宿主：native。 */
    private defaultHostKind;
    protected readonly settingsManager?: SettingsManager;
    init(): void;
    refresh(): Promise<boolean>;
    setHostKind(kind: MainAgentHostKind, connectionId?: string): void;
    /** ACP initialize：客户端是否声明了 mainAgentSupport。按连接隔离，避免多连接互相覆盖。 */
    setClientOptedIn(optedIn: boolean, connectionId?: string): void;
    removeConnection(connectionId: string): void;
    /**
     * Stamp the host kind for the connection that currently owns the request.
     *
     * Host identity is transport/session ownership, not an immutable property
     * of the serialized conversation. An opted-in Web connection may reclaim a
     * session previously opened by an unopted host; an unopted connection still
     * always downgrades an opted-in session before deriving its modes/tools.
     */
    stampHostKind(session: Session | undefined, connectionId?: string): void;
    getPolicy(): MainAgentPolicy;
    isSettingsEnabled(): boolean;
    isEnabled(connectionId?: string): boolean;
    /** 是否已有未 opt-in 的 ACP 连接（WorkBuddy）。 */
    hasUnoptedConnection(): boolean;
    /** 按会话归属的 ACP 连接判定 gate；非 ACP 会话回退 native。 */
    isEnabledForSession(session?: Session): boolean;
    getHostKind(connectionId?: string): MainAgentHostKind;
}
/**
 * 防御性获取 gate provider（测试 stub / 组件未注册场景返回 undefined）。
 *
 * 调用方统一用 `getMainAgentGateProvider()?.isEnabled() ?? false`，
 * 避免 ContainerUtil.get 返回非真实例（如测试 mock）时炸 isEnabled。
 */
export declare function getMainAgentGateProvider(): MainAgentGateProvider | undefined;
/**
 * Persist a host-kind stamp without making ACP session setup depend on a fully
 * wired SessionManager. Production hosts still persist normally; reduced ACP
 * hosts and unit-test adapters may omit `save`, and persistence failures must
 * never escape as unhandled rejections after a successful handshake.
 */
export declare function persistMainAgentHostKind(session: Session, sessionManager: {
    save?: (value: Session) => Promise<unknown> | unknown;
} | undefined, onError?: (error: unknown) => void): void;
/**
 * 解析 session 的主 agent 选择（纯函数，设计 v0.6 §3.2）。
 *
 * mainKey 是会话持久默认：仅当 gate 打开且 session.meta 存在该键时返回；
 * 存在性校验（agentManager.get）由调用方负责，未命中即跳过（fallback
 * 精确化：跳过 mainKey 分支，继续既有链，最终回落 default）。
 *
 * @param session 目标会话（可能为空）
 * @param options.gateEnabled run 层 gate 同步布尔（MainAgentGateProvider.isEnabled()）
 * @returns 主 agent 名（未启用/未设置时 undefined）
 */
export declare function resolveMainAgentName(session: Session | undefined, options: {
    gateEnabled: boolean;
}): string | undefined;
/** 解析链所需的 agentManager 能力面（便于单测注入） */
export interface MainAgentResolutionDeps {
    getDefaultAgentName(): string;
    get(agentName: string): Promise<Agent | undefined>;
    getDefault(): Promise<Agent>;
    /**
     * 可选：settings 配置的默认主 agent（codebuddy.mainAgent.default，设置页"设默认"）。
     * 仅在 gate 打开时生效；未配置/未命中回退产品默认 agent。
     */
    getConfiguredDefaultName?(): Promise<string | undefined>;
    /**
     * 可选：上次 chip 选择（codebuddy.mainAgent.lastUsed）。
     * 仅空白会话、且未配置 `default` 时生效。不是「设为默认」。
     */
    getLastUsedName?(): Promise<string | undefined>;
}
/** 解析链日志回调（调用方注入 logger，保持纯函数可单测） */
export type MainAgentResolutionLog = (level: 'warn', message: string) => void;
export interface PickMainAgentNameInput {
    session?: Session;
    gateEnabled: boolean;
    defaultAgentName: string;
    /**
     * true：run / chip（含 @agent leftover）。
     * false：fork inherit，只跟站立键 / 空白默认，不吃 telemetry。
     */
    includeMention: boolean;
    /** true：本轮 run 用协调器工具面。Code Mode 站立除外。chip / inherit 不要开。 */
    useCoordinatorRuntime?: boolean;
    /** 名字是否可解析。run 用 get()；chip 用 configNames，避免等 MCP rebuild。 */
    nameExists: (name: string) => boolean | Promise<boolean>;
    getConfiguredDefaultName?: () => Promise<string | undefined>;
    getLastUsedName?: () => Promise<string | undefined>;
    log?: MainAgentResolutionLog;
}
/**
 * 主 agent **选名**唯一实现。run 与 chip 必须走这里，禁止再抄一套 Step 1/2/2.5。
 *
 * 0 compact → default
 * 1 mention（可选）：先 @agent / 自定义，再 overlay 协调器 run，再 leftover；shipped leftover 须等于 mainKey
 * 2 mainKey（gate 开；Explore 等子代理名跳过）
 * 2.5/2.55 仅空白会话：settings default → lastUsed
 * 3 产品默认
 */
export declare function pickMainAgentName(input: PickMainAgentNameInput): Promise<string>;
/**
 * 完整的主 agent 解析链（设计 v0.6 §3.2）。
 * 选名只走 `pickMainAgentName`；本函数只负责把名字变成 Agent 实例。
 */
export declare function resolveMainAgentForSession(session: Session | undefined, deps: MainAgentResolutionDeps, options: {
    gateEnabled: boolean;
}, log?: MainAgentResolutionLog): Promise<Agent>;
/**
 * 会话的「站立」主 agent（mainKey → 配置默认 → 产品默认）。
 *
 * 不读 `session.agentName` / `meta.agentName`：那是 @agent / telemetry 的
 * 临时身份，fork 子代理应对齐 DSH composeFrom，继承父会话的 preset，
 * 而不是某轮 mention 切换。
 */
export declare function resolveInheritedMainAgent(session: Session | undefined, deps: MainAgentResolutionDeps, options: {
    gateEnabled: boolean;
}, log?: MainAgentResolutionLog): Promise<Agent>;
/** 一次 settings 读取同时提供 default / lastUsed，给解析链注入。 */
export declare function mainAgentSettingsReaders(readCodebuddy: () => Promise<{
    mainAgent?: {
        default?: unknown;
        lastUsed?: unknown;
    };
} | undefined>): {
    getConfiguredDefaultName(): Promise<string | undefined>;
    getLastUsedName(): Promise<string | undefined>;
};
/** 把 chip 选择写进 user settings `codebuddy.mainAgent.lastUsed`（不碰 default）。 */
export declare function persistMainAgentLastUsed(settingsManager: SettingsManager | undefined, name: string | undefined): Promise<void>;
