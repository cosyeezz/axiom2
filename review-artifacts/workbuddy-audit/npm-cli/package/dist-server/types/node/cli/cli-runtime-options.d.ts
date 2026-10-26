import { SessionOptions } from '../../vendor/cbc-core/node/index.js';
import { type Observable } from 'rxjs';
/**
 * Fields of `SessionOptions` that are set on a per-session basis AND
 * are also accepted as process-level CLI flags (e.g. `--permission-mode`,
 * `--model`).
 *
 * In non-serve modes the CLI flow (`RequestBuilder` → `CliExecutor` /
 * `InteractiveExecutor` → POST `/internal/agent`) naturally carries these
 * values in the HTTP body, so `SessionMiddleware` can merge them into
 * `session.options` and they take effect.
 *
 * In `--serve` mode, external ACP clients initiate sessions through
 * `AcpAgentImpl.initializeSession()`, which does NOT see the CLI argv.
 * Without re-injection, CLI flags passed to the agent-cli process are
 * silently dropped for ACP-created sessions, leading to inconsistent
 * behaviour between the two launch paths (e.g. `--permission-mode plan`
 * not being applied to ACP sessions).
 *
 * `CliRuntimeOptions` centralises the subset of CLI flags that should
 * propagate to every session created within the same process, so that
 * internal consumers (currently AcpAgent) can merge them into their
 * synthetic `/internal/agent` request body and stay in lockstep with the
 * non-serve path.
 */
/**
 * `--permission-mode` 可进进程默认 / Web chip 的值（与 SessionOptions.permissionMode 对齐）。
 *
 * 它是 PermissionMode 枚举的 **argv 子集**：ignore / work 是会话内部状态（委托是会话 overlay，不是权限模式），
 * 不做进程模式；dispatch 面另有一层更窄的表（不含 fullAccess）。改这里前先读那两处。
 */
export declare const CLI_PROCESS_PERMISSION_MODES: readonly ["default", "acceptEdits", "bypassPermissions", "plan", "dontAsk", "auto", "fullAccess"];
export type CliProcessPermissionMode = (typeof CLI_PROCESS_PERMISSION_MODES)[number];
/**
 * `--permission-mode` 是否是进程认的值。
 * 建同事（agent-home）把模式写进档案、启 job 时拼进 argv，校验必须与 CLI 同一张表。
 */
export declare function isCliProcessPermissionMode(value: string): value is CliProcessPermissionMode;
/** `--serve` / Web 新会话用的进程默认（不写 settings）。 */
export interface CliProcessDefaults {
    agent?: string;
    permissionMode?: CliProcessPermissionMode;
}
export declare function pickCliProcessDefaults(raw: {
    agent?: unknown;
    permissionMode?: unknown;
}): CliProcessDefaults;
/** snapshot（CliRuntimeOptions）优先，argv `--agent` 作 fork/rebuild 前的回退。 */
export declare function resolveCliProcessDefaults(snapshot: {
    agent?: unknown;
    permissionMode?: unknown;
}, fallbackAgentName?: string): CliProcessDefaults;
export type CliSessionInitialOptions = Pick<SessionOptions, 'sessionId' | 'permissionMode' | 'permissionModeBeforePlan' | 'subagentPermissionMode' | 'dangerouslySkipPermissions' | 'model' | 'fallbackModel' | 'textToImageModel' | 'imageToImageModel' | 'tools' | 'allowedTools' | 'disallowedTools' | 'addDir' | 'channels' | 'dangerouslyLoadDevelopmentChannels' | 'mcpConfig' | 'strictMcpConfig' | 'sessionPersistence'> & {
    /** `--agent`：进程默认主 agent。不是 SessionOptions 字段，不摊进 session.options。 */
    agent?: string;
    /** 内部恢复通道；只在显式传入时进入 `/internal/agent` 请求。 */
    privateDataSticky?: true;
};
/**
 * Full argv-derived option bag accepted by {@link CliRuntimeOptions.set}.
 * `get()` deliberately exposes only the curated session-initialisation subset,
 * while process-only consumers read flags such as `pluginManagement`, `acp`
 * and `serve` through dedicated helpers on `CliRuntimeOptions`.
 */
export type CliRuntimeInputOptions = CliSessionInitialOptions & Record<string, unknown>;
export interface PrivateDataStickyReservation {
    readonly reserved: boolean;
    commit(): void;
    release(): void;
}
/**
 * Process-level snapshot of CLI-provided session initialisation options.
 *
 * Written once by the CLI bootstrap (see `cli-dispatcher`) after argv is
 * parsed, and read by internal components that construct
 * `/internal/agent` requests without going through `RequestBuilder`
 * (currently `AcpAgentImpl.initializeSession`).
 *
 * Only fields listed in `CliSessionInitialOptions` are retained — other
 * CLI flags (`--serve`, `--port`, `--host`, `--acp`, ...) are
 * process-level runtime flags and must not leak into session options.
 */
export declare class CliRuntimeOptions {
    private snapshot;
    private privateDataStickyReservation?;
    /**
     * 全量 CLI opts 序列，用于变更去重。
     *
     * ⚠️ 注意去重的对象**不是** `snapshot`（它只保留 CliSessionInitialOptions
     * 那十几个字段），而是 set() 收到的**原始全量 opts**。因为 settings provider
     * 关心的 `--effort` / `--settings` / `--setting-sources` 都不在 snapshot 里，
     * 若按 snapshot 去重，仅改动这些字段的 activate 会被 distinctUntilChanged
     * 误判为"无变化"而吞掉。故 seed 用 `{}`，每次 set() 推入全量 raw opts，
     * 由 distinctUntilChanged 做结构比较。
     */
    private readonly rawOptsSubject;
    /**
     * 进程级 CLI 参数变更信号（BehaviorSubject 语义，对齐 CwdService.onDidChangeCwd）。
     *
     * 触发时机：
     *   1. 【订阅瞬间】种子值：任何 subscribe() 当下**同步**收到一次信号，
     *      供订阅方首轮初始化——无需再单独跑一遍"首次加载"逻辑。
     *   2. 【主动广播】`set()` 且全量 opts **确实变化**：CliDispatcher 解析完 argv
     *      后调用，唯一两个触发点是冷启动（onStart）与预热 activate（applyPrewarmArgs）。
     *      重复 set() 相同 opts 被 distinctUntilChanged 拦掉，避免无谓重解析。
     *
     * 设计意图：依赖 `process.argv` 的 provider（CliSettingsProvider /
     * CliSettingSourcesProvider）只需 `onDidChange.subscribe(() => this.reload())`，
     * 订阅即触发首次加载，set() 再触发刷新，两条路径合一。预热进程 standby 阶段
     * 拿到的是空 opts，activate set() 后自动重解析，无需 CliDispatcher 反向感知
     * 有哪些 provider 要刷新。值统一发 `void`——订阅方自行从 `process.argv` 重解析。
     */
    readonly onDidChange: Observable<void>;
    set(options: CliRuntimeInputOptions): void;
    /**
     * Returns a fresh shallow copy so callers can safely spread / mutate.
     * Only keys with non-undefined values are included.
     */
    get(): CliSessionInitialOptions;
    /**
     * The CLI owns plugin runtime refresh. A host management adapter can
     * override this to resolve installation snapshots without starting MCP.
     */
    isPluginSnapshotOnly(): boolean;
    /**
     * 为一次 Session admission 预留进程级隐私恢复标记。
     *
     * 标记只有在 admission 成功后才由 `commit()` 消费；失败调用 `release()` 后，
     * 下一次初始化仍可继承。预留未决期间其他调用会等待，避免持有者失败时另一个
     * Session 无标记穿过。
     *
     * 并发语义（MR 评审 B1 的澄清，2026-09-22）：`while` 里的 await 只用来「等待
     * 已有持有者」；循环一旦退出，「判空 → 占位」是同一段同步代码（两者之间没有
     * await），因此不存在两个等待者同时占位、或等待者拿到别人 reservation 的窗口：
     * A 持有 → B/C 一起等 A → A settle 后 B 先同步占位 R_B，C 只能接着等 R_B。
     * 串行是刻意的——一次性标记必须只交付给一个成功 admission 的 Session；而
     * 「持有者永不 settle」这条尾部风险由调用方兜底（见 AcpAgent 的 admission 超时）。
     */
    reservePrivateDataSticky(): Promise<PrivateDataStickyReservation>;
    /**
     * Whether marketplace and Plugin lifecycle writes are owned by another
     * process. Plugin discovery is cache-first in every runtime; this switch
     * only removes management authority from a Harness Session child.
     */
    isPluginManagementDisabled(): boolean;
}
