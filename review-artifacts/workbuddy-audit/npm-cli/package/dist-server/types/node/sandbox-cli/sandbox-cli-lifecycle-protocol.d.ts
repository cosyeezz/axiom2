/**
 * Sandbox CLI Lifecycle Protocol
 *
 * 定义 SandboxCLILifecycle 的 DI Symbol、BootstrapOptions 以及 ISandboxCLILifecycle 接口。
 *
 * SandboxCLILifecycle 专管 sandbox-cli 进程与 session 级 IPC 骨架的生命周期：
 * spawn → connect → OpenSession → 探活 → session 切换 → 优雅停止。
 *
 * 通过 onSessionReady callback 机制让外部模块注册 post-OpenSession 逻辑
 * （如规则同步），lifecycle 保证每次 OpenSession 成功后统一触发。
 * 通过 getReadyGeneration() 计数器语义性地向外暴露 "发生过几次 OpenSession 成功"，
 * 让外部按需做各自的重新初始化。
 */
import type { SandboxCLIClient as ISandboxCLIClient } from './sandbox-cli-protocol';
export declare const SandboxCLILifecycle: unique symbol;
/**
 * Lifecycle 首次启动时固化的引导参数。
 *
 * 后续 ensureReady(...) 调用传入的 options 会被忽略（幂等保证只启动一次）。
 * 决定性调用方为 SandboxAgentRunInterceptor，在每轮 prompt 到达时通过
 * ensureReady 确保 sandbox-cli 就绪；session 切换时先 stop 再重新 ensureReady。
 */
export interface BootstrapOptions {
    /** 首次 OpenSession 要用的 sessionId（必填） */
    sessionId: string;
    /**
     * OpenSession 的工作目录，sandbox 中心规则里 `{SESSION_WORKSPACE}` 按它展开。
     * 缺省时 CLI 进程用进程工作目录，即会话目录；库运行时一个进程服务多个会话，
     * 用调用时会话的工作目录。
     */
    workingDir?: string;
    /**
     * 宿主 App 家目录，透传到 sandbox-cli 的 `--app_home` 参数。
     * 由 SandboxAgentRunInterceptor 在调用 ensureReady 时传入。
     * 缺省时 sandbox-cli 回退到平台默认路径
     * （Windows: `%LOCALAPPDATA%\WorkBuddy`；其他: `$HOME/.local/share/WorkBuddy`）。
     */
    appHomeDir?: string;
    /**
     * （仅 macOS）App Group ID，透传到 sandbox-cli 的 `--app_group_id` 参数，
     * 非 macOS 下被忽略。
     */
    appGroupId?: string;
    /** sandbox-cli 是否显示独立控制台窗口 */
    showConsoleWindow?: boolean;
    /**
     * 当前轮 conversationRequestId（来源：`session.conversationRequestId`），仅作为
     * `sandbox.daemon.failure` 上报字段透传，不参与 daemon 启动协议。
     */
    conversationRequestId?: string;
    /**
     * 本次启动的截止时间（毫秒）。到点 ensureReady 的 promise 以超时拒绝，
     * 并走现有超时收尾（best-effort 终止已起来的子进程 + 清缓存允许重试）——
     * 截止落在 lifecycle 这份 promise 上，所有 waitReady 消费方（bash 工具等）
     * 到点立即拿到失败，不会挂到 30s hard timeout。缺省用默认 hard timeout。
     */
    deadlineMs?: number;
}
/**
 * OpenSession 成功后传递给回调的上下文。
 */
export interface SessionReadyContext {
    /** 本次 OpenSession 的 sessionId */
    sessionId: string;
    /** 本次就绪后的 generation（递增计数器） */
    generation: number;
    /** 触发原因 */
    reason: 'bootstrap' | 'restart';
}
/**
 * 注册到 lifecycle 的 session-ready 回调。
 * lifecycle 会 await 所有回调完成后才对外 resolve ensureReady。
 */
export type SessionReadyCallback = (ctx: SessionReadyContext) => Promise<void>;
/**
 * SandboxCLILifecycle 接口
 */
export interface ISandboxCLILifecycle {
    /**
     * 幂等启动：spawn + connect + OpenSession。
     * 已启动则直接返回。首次调用时 options 会被固化。
     */
    ensureReady(options: BootstrapOptions): Promise<void>;
    /**
     * ping 探活，失败则 restart。
     */
    ensureAlive(): Promise<void>;
    /**
     * 当前已 OpenSession 的 sessionId。
     */
    getOpenedSessionId(): string | undefined;
    /**
     * 获取已连接的 IPC client。
     */
    getClient(): ISandboxCLIClient;
    /**
     * 每次 OpenSession 成功（首次启动 / restart 后重建）递增。
     * 外部用它判断 "是否发生了新的 OpenSession"，用于触发各自的重新初始化。
     */
    getReadyGeneration(): number;
    /**
     * 等待 sandbox-cli 就绪（不触发启动）。
     *
     * 仅消费已有的启动 Promise，不会主动创建新的启动流程。
     * 若 ensureReady 从未被调用或上次启动失败，立即 reject。
     * 调用方应 try-catch 并自行决定降级策略。
     */
    waitReady(): Promise<void>;
    /**
     * 优雅停止 sandbox-cli。
     */
    stop(): Promise<void>;
    /**
     * 注册 OpenSession 成功后的回调。
     * 每次 OpenSession 成功（bootstrap / restart / session-switch）都会依次调用
     * 所有已注册的回调，单个回调失败不阻断后续回调。
     *
     * @param callback 回调函数
     * @returns 取消注册的 disposer
     */
    onSessionReady(callback: SessionReadyCallback): () => void;
}
