import { Logger } from '@celljs/core';
import { type SandboxCenterIpcClient as ISandboxCenterIpcClient } from '../sensitive-content/sandbox-center-ipc-client-protocol';
import { type SandboxTelemetryReporter as ISandboxTelemetryReporter } from '../telemetry/sandbox-telemetry-protocol';
import { type ISandboxCLILifecycle } from './sandbox-cli-lifecycle-protocol';
import { type SandboxTurnConfig as ISandboxTurnConfig } from './sandbox-turn-config';
export interface ThreatDomainCheckResult {
    available: boolean;
    malicious: boolean;
    requestedDomain?: string;
    matchedDomain?: string;
    label?: string;
    mainDomainMatch?: boolean;
}
export declare const ThreatDomainChecker: unique symbol;
export interface ThreatDomainChecker {
    /** 把持久化状态中的当前 DB 同步到已运行的 sandbox-cli。 */
    sync(context: {
        sessionId: string;
        conversationRequestId?: string;
    }): Promise<boolean>;
    /**
     * 调用方已完成 ensureReady/ensureAlive 时使用，避免重复探活。
     * 该方法始终复用 lifecycle 当前已打开的 session，不切换或停止进程。
     */
    syncReady(context: {
        sessionId: string;
        conversationRequestId?: string;
    }): Promise<boolean>;
    check(hostname: string, context: {
        sessionId: string;
        conversationRequestId?: string;
    }): Promise<ThreatDomainCheckResult>;
    /** sandbox-cli 里当前真正加载的库版本，供命中埋点标注是哪一版拦下的；从未加载成功时为空。 */
    getLoadedVersion(): string | undefined;
}
/**
 * agent-cli 侧恶意域名查询入口。
 *
 * SQLite 只由 sandbox-center/Rust 打开；Web 工具通过 `decide_network` 查询，避免在 TS
 * 再维护一套 SQLite 依赖、域名标准化和主域匹配逻辑。
 */
export declare class ThreatDomainCheckerImpl implements ThreatDomainChecker {
    protected readonly logger: Logger;
    protected readonly lifecycle?: ISandboxCLILifecycle;
    protected readonly sandboxCenterClient?: ISandboxCenterIpcClient;
    protected readonly sandboxTurnConfig?: ISandboxTurnConfig;
    protected readonly telemetryReporter?: ISandboxTelemetryReporter;
    private loadedPath?;
    private loadedGeneration?;
    private loadedCenterGeneration?;
    /**
     * sandbox-cli 进程里当前这个 reader 实际加载的库版本，只在 SetThreatDatabase 成功后才更新。
     *
     * 与 state.json 此刻的 activeVersion 分开保存：磁盘可能已经换代而 CLI 仍困在旧 reader 上，
     * 埋点要报的是后者，否则最需要被发现的那类分叉恰好看不见。
     */
    private loadedVersion?;
    private readonly reportedTelemetryTurns;
    /** 串行化 manager 进程级 reader 的启用/停用，避免并发 WebFetch 与开关切换互相覆盖。 */
    private syncQueue;
    /** 最近一次 SetThreatDatabase 失败，用于抑制高频重试，见 isSetFailureCached。 */
    private setFailure?;
    /** 忘掉本代 reader：三个字段必须同进同出，分开清会让埋点报出一个已经不存在的版本。 */
    private clearLoadedReader;
    /**
     * sandbox-cli 里当前真正加载的库版本，供命中埋点标注是哪一版拦下的。
     *
     * 与 `resolveThreatDatabaseRuntimeConfig().version`（磁盘视角）不同，这里是进程视角。
     */
    getLoadedVersion(): string | undefined;
    /**
     * 本代 sandbox-cli 里那个 SQLite reader 是否仍然活着，活着就返回它所在的 session。
     *
     * Rust 侧只在收到 `SetThreatDatabase{enabled:false}` 或进程退出时才卸载 reader，所以
     * 「同步失败」不等于「查不了」。这两件事必须分开报：若同步一失败就一律 `queryAvailable=false`，
     * Bash 侧还在走沙箱内的旧 reader 继续拦，WebFetch 这条旁路却直接放行——同一个域名两个工具
     * 给出相反结论，模型据此会得出「换个工具就能过」，而这正是需求明确禁止的。
     */
    private getAliveReaderSessionId;
    /**
     * 同一 `(path, generation)` 上刚失败过的 SetThreatDatabase 是否应跳过重试。
     *
     * 失败不写 `loadedPath`（否则会谎称已加载），于是下一次进来判据依然成立、再发一次。
     * 而调用密度是每条沙箱命令一次 + 每个 WebFetch URL 一次（重定向逐跳累加），一旦
     * sandbox-cli 根本不认这个命令——Linux 目前钉在不含威胁库能力的版本，这是必然存在的
     * 过渡态——就变成每条命令都白付一次 IPC 往返并刷一条 warn。
     *
     * 用冷却窗口而不是永久负缓存：进程/版本没变但 IPC 偶发抖动的情况必须还能自己恢复，
     * 否则防护会静默停在关闭状态直到沙箱重启。path 或 generation 变化时判据自然失效。
     */
    private isSetFailureCached;
    check(hostname: string, context: {
        sessionId: string;
        conversationRequestId?: string;
    }): Promise<ThreatDomainCheckResult>;
    sync(context: {
        sessionId: string;
        conversationRequestId?: string;
    }): Promise<boolean>;
    syncReady(context: {
        sessionId: string;
        conversationRequestId?: string;
    }): Promise<boolean>;
    /**
     * 确保当前 DB 已同步到 sandbox-cli，返回可用性 + 不生效原因。
     *
     * 埋点是严格旁路：同一个 sessionId + conversationRequestId 最多尝试上报一次，
     * 任何 reporter 异常均被吞掉，不能改变 DB 同步、域名查询或放行/拦截结果。
     */
    private syncInternal;
    private reportSyncTelemetryOnce;
    /**
     * 把当前 DB 同步进 sandbox-cli，并区分当前库同步状态与旧 reader 查询能力。
     * `sync-failed` 覆盖 ensureReady / SetThreatDatabase 失败——后者的 IPC 结果是
     * Rust 端 `threat_database.load` 的真实成败信号，load 失败会 response_err 抛回。
     */
    private syncToSandbox;
    /**
     * 关闭开关时停用进程内的 SQLite reader。这里只关闭连接，不删除本地 DB，也不会
     * 触发下载；再次开启时直接复用 state.json 指向的同一文件。没有活跃 sandbox-cli
     * 时无需为了“关闭”而启动进程。停用失败时保持 fail-safe（旧 reader 仍生效），
     * 但错误只记日志/埋点，不阻塞设置保存或命令主链路。
     */
    private disableThreatDatabase;
}
/**
 * 解析 daemon 更新器发布的当前 DB。
 *
 * 环境变量仅保留为手工测试兜底；正常 Desktop 链路读取 configDir 下的原子状态
 * 文件，因此 daemon 更新后不需要修改已经启动的 agent-cli 进程环境。
 */
export declare function resolveThreatDatabaseRuntimeConfig(): {
    enabled: boolean;
    path?: string;
    /** state.json 记录的库版本，仅用于埋点；env 兜底路径没有版本可言，此时不下发。 */
    version?: string;
};
