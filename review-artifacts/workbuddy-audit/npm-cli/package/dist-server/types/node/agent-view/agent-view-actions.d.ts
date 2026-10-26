import { type AgentJobState, type AgentJobView, type IJobStore } from './agent-view-protocol';
import { stripPositionalArgs } from './job-respawn-args';
import { type Workspace } from './launch-workspace';
export { stripPositionalArgs };
export interface AgentViewActionDeps {
    store: IJobStore;
    /** Injectable for process fakes; production always validates the real cwd. */
    prepareWorkspace?: (state: Workspace) => Promise<string>;
    /** 复用 DaemonProcessManager 的 detached fork 与信号能力 */
    processManager: {
        forkBgSession(args: string[], options: {
            name?: string;
            cwd?: string;
            extraEnv?: Record<string, string>;
            skipPrintMode?: boolean;
            jobWorker?: boolean;
            headlessJobWorker?: boolean;
        }): Promise<{
            pid: number;
            logPath: string;
        }>;
        sendSignal(pid: number, signal: NodeJS.Signals): boolean;
        isProcessRunning(pid: number): boolean;
        waitForExit(pid: number, timeoutMs?: number): Promise<boolean>;
    };
    /** 日志目录，shell job 的输出落在这里 */
    logDir: string;
    /**
     * detached worker 的形态，决定这个 job 还能不能被终端接管。
     *
     * 默认（`false` / TUI）：`jobWorker` → broker 托管一个 PTY 里的**常驻交互**
     * 会话，agent view 的回车 / `→` / Esc 才接得回去。
     * `true`（Web UI 的 ACP/HTTP job）：没有终端契约，直接跑 headless
     * `--print` 一次性进程，省掉 broker 那一层 —— 代价是没有 attachSocket，
     * 终端侧永远接不进去。
     */
    headlessJobs?: boolean;
    /**
     * Optional override for tests. Default: kill(0) + process-start identity.
     * Identity mismatch ⇒ not alive (do not signal).
     */
    isJobProcessAlive?(pid: number | undefined, identity: {
        procStart?: string | null;
        procStartFt?: string | null;
        procStartTicks?: string | null;
    } | undefined): Promise<boolean>;
}
/**
 * detached worker 的 fork 选项。
 *
 * `jobWorker` 会让子进程以 broker 模式托管 PTY（不注入 `--print`），这是
 * attach 的唯一前提：没有 PTY 就没有 attachSocket，回车只能干等到超时。
 * 所以默认必须是 broker，只有明确不要终端的 Web UI job 才走 headless。
 */
export declare function workerSpawnOptions(deps: Pick<AgentViewActionDeps, 'headlessJobs'>): {
    jobWorker: true;
} | {
    headlessJobWorker: true;
};
export interface DispatchOptions {
    prompt: string;
    cwd: string;
    /** 指定主 agent */
    agent?: string;
    /** 覆盖模型 */
    model?: string;
    /** 覆盖权限模式 */
    permissionMode?: string;
    /** 覆盖推理投入档位 */
    effort?: string;
    /** 用户显式命名 */
    name?: string;
    /** 后台首次写文件时是否自动进入隔离 worktree；缺省继续跟随 TUI/全局设置。 */
    bgIsolation?: 'none' | 'worktree';
    /**
     * 注入到首条 prompt 之前的隐藏上下文（如主会话受限预览）。
     * 只进入 spawn 的位置参数；intent/initialPrompt 保持干净 prompt，
     * 标题与列表不受污染。
     */
    contextPrefix?: string;
    /**
     * 打开 agent view 时给的配置 flag（`--effort` / `--settings` / `--add-dir`
     * / `--plugin-dir` / `--mcp-config` / `--strict-mcp-config` 等）。
     * 文档要求这些 flag 既作用于视图自身也透传给它派发的每个会话。
     */
    extraFlags?: readonly string[];
}
export interface DispatchResult {
    id: string;
    pid: number;
    logPath: string;
}
export interface DispatchLifecycle {
    /**
     * The durable job record now exists and can be selected by clients. Process
     * startup intentionally happens afterwards so HTTP callers do not wait for
     * the worker to finish booting before entering the agent view.
     */
    onJobCreated?: (job: {
        id: string;
        sessionId: string;
    }) => void | Promise<void>;
    /** Keep an already-visible row restartable when worker startup fails. */
    keepJobOnStartupFailure?: boolean;
}
/**
 * 派发一个新的后台会话。
 *
 * 顺序很关键：先生成 sessionId 并建好 job 目录，再 fork。
 * 反过来的话子进程可能在 job 目录存在之前就开始汇报状态，
 * 那些汇报会静默丢掉，行上就会一直停在 "starting…"。
 */
export declare function dispatchBackgroundSession(deps: AgentViewActionDeps, options: DispatchOptions, lifecycle?: DispatchLifecycle): Promise<DispatchResult>;
/**
 * 把一个历史会话作为后台 job 重新挂回列表（agent view 里的 `/resume` picker）。
 *
 * 靠 `--resume <sessionId>` 拉起常驻 worker：只恢复历史、不重放任何 prompt，
 * 回来后停在 idle 等你下一句话（与 respawn 同构，但这里 job 记录是新建的
 * —— 之前它可能已从列表删除，只剩磁盘上的 transcript）。
 */
export declare function resumeSessionAsJob(deps: AgentViewActionDeps, options: {
    sessionId: string;
    cwd: string;
    name?: string;
    extraFlags?: readonly string[];
}): Promise<DispatchResult>;
/**
 * 还没开过 1:1 的同事：起一个空会话 job，停在 idle 等收件箱。
 * 不把频道信封当位置参数（那会画成用户气泡）。
 */
export declare function spawnIdleBackgroundSession(deps: AgentViewActionDeps, options: {
    cwd: string;
    name?: string;
    agent?: string;
    /** 这个同事固定跑哪个模型 / 权限模式（建人时定，随 respawnArgs 一起持久化）。 */
    model?: string;
    permissionMode?: string;
}): Promise<DispatchResult>;
/**
 * 派发一个 shell job（输入框 `!` 前缀）。
 *
 * 不调用模型，输出也不进任何会话——就是把一条命令挂在后台跑，
 * 行上显示它最近一行输出。
 */
export declare function dispatchShellJob(deps: AgentViewActionDeps, options: {
    command: string;
    cwd: string;
}): Promise<DispatchResult>;
/**
 * 读取日志尾部的若干非空行。
 *
 * 后台会话跑在 `-p` 模式下，模型的最终回答就是它写到日志里的内容，
 * 所以这是"不发起额外模型请求就能拿到结果摘要"的唯一来源
 * （对齐 Claude 的 15 秒无请求刷新路径）。
 */
export declare function readLogTailLines(logPath: string, maxLines?: number): Promise<string[]>;
/** 读取日志最后一行，作为 shell job 的行内摘要 */
export declare function readLogTailLine(logPath: string): Promise<string | undefined>;
/** 停止会话进程并把状态标记为 stopped */
export declare function stopJob(deps: AgentViewActionDeps, job: AgentJobView): Promise<void>;
export interface DeleteJobResult {
    deleted: boolean;
    /** 未删除时的原因，会渲染成行内 `not deleted` 提示 */
    reason?: string;
    /** 会话已删但 worktree 目录被保留在盘上时，报出它的路径 */
    keptWorktreePath?: string;
}
/** 判断 worktree 能否安全移除。返回 undefined 表示可以删 */
export type WorktreeGuard = (job: AgentJobView) => Promise<string | undefined>;
export interface DeleteJobOptions {
    worktreeGuard?: WorktreeGuard;
    /**
     * 守卫放行后移除会话代管的 worktree（含未提交更改）。
     * 抛错表示目录被保留 —— 会话照删，路径途经 keptWorktreePath 报出。
     */
    removeWorktree?: (worktreePath: string) => Promise<void>;
}
/**
 * 删除会话。
 *
 * 会话与它的 worktree 是绑定的：守卫拒绝（未推送 commit / 他会话占用）时
 * 会话也必须留下，否则用户就再也找不到那些提交在哪了（行上会显示
 * `not deleted` + 原因）。守卫放行后删会话，再尽力移除代管 worktree；
 * 移除失败（如 git 已不认识它）不回滚删除，只报出被保留的路径。
 */
export declare function deleteJob(deps: AgentViewActionDeps, job: AgentJobView, options?: DeleteJobOptions | WorktreeGuard): Promise<DeleteJobResult>;
/**
 * 重启会话，保留对话。
 *
 * 靠 `--resume <sessionId>` 让新进程接上原来的 transcript；
 * respawnArgs 里的模型/权限/agent 参数原样回放，避免重启后行为漂移。
 */
export declare function respawnJob(deps: AgentViewActionDeps, job: AgentJobView): Promise<DispatchResult>;
export interface SendReplyResult {
    /** 已写入收件箱，运行中的会话会消费 */
    delivered: boolean;
    /** 进程不在，已存为下次启动的首个 prompt */
    saved: boolean;
    /** 给用户看的提示 */
    notice: string;
}
/**
 * 把回复送给一个会话。
 *
 * 进程活着就进收件箱，由会话进程内的 `JobInboxConsumer` 走**逻辑消息通道**
 * 送进对话（不是往 PTY 里模拟按键——那会在权限框、AskUserQuestion 之类的
 * 对话框上变成误操作）。进程已退出则存成 pending，会话下次启动时补发。
 *
 * `!` 开头的 Bash 回复两条路都走不了：会话层没有 `!` 这个概念，
 * 送过去只会以纯文本抵达，"执行命令"就变成了"说了句话"，属于静默错误。
 * 所以明确拒绝，并告诉用户去哪儿才能执行。
 */
export declare function sendReply(deps: AgentViewActionDeps, job: AgentJobView, reply: {
    text: string;
    bash?: boolean;
}): Promise<SendReplyResult>;
export interface AttachHandoff {
    /** 要执行的 CLI 入口 */
    entry: string;
    /** 传给入口的参数 */
    args: string[];
    /** 子进程工作目录 */
    cwd: string;
}
/**
 * 构造"接管一个会话"的启动参数。
 *
 * agent view 与后台会话是两个进程，接管的实现是在当前终端里用
 * `--resume <sessionId>` 拉起完整交互会话——transcript 已经在盘上，
 * 所以对话历史是完整的，不是只看日志。
 */
export declare function buildAttachHandoff(job: AgentJobState, entry: string): AttachHandoff;
