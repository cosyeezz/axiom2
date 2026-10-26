/**
 * 前台会话 → 后台 job 的交接编排。
 *
 * 顺序对照 Claude `Z5f` / design.md D6：job 记录先落盘，再 adopt，再 flush，
 * 再 spawn；spawn 失败必须回滚 job 目录，前台保持存活。
 */
import { type PermissionMode } from '../../vendor/cbc-shared/node/index.js';
import { type AgentViewActionDeps } from './agent-view-actions';
import { type HandoffVia, type InFlightTask } from './handoff-policy';
/** 派生 seed 时用的最小消息形状 */
export interface HandoffSeedMessage {
    type: string;
    /** 用户消息正文；assistant 的可见摘要也可放这里 */
    text?: string;
    isMeta?: boolean;
}
export interface HandoffSeed {
    intent: string;
    name?: string;
    nameSource?: 'user' | 'auto';
    detail?: string;
}
/**
 * 转后台时落盘的「在跑工作」清单。
 *
 * 这里**不含** abort-then-fork 的 prefill：那段没发完的输入已经作为 worker 的
 * 首个位置参数投递了（见 {@link buildResumeArgs}），而 adopt.json 从来没有
 * 消费方。留着它只会多出一条同文本的投递路径 —— 哪天有人接上消费侧，
 * 用户那句话就会被执行两遍。同一段文本只允许有一个可靠承载点。
 */
export interface AdoptPayload {
    writtenAtMs: number;
    shells: Array<{
        id: string;
        label: string;
        kind: string;
        outputFilePath?: string;
        outputStderrPath?: string;
    }>;
    cron: Array<{
        id: string;
        label: string;
    }>;
    agents: Array<{
        id: string;
        label: string;
        sessionId?: string;
        agentType?: string;
    }>;
    workflows: Array<{
        id: string;
        label: string;
    }>;
}
export interface SessionHandoffDeps extends AgentViewActionDeps {
    /** flush 当前 transcript；超时不阻断交接 */
    flushTranscript: () => Promise<void>;
    /** spawn 成功后：前台不再写 transcript */
    releaseOwnership: () => void | Promise<void>;
    /** abort-then-fork：中止当前轮次 */
    abortTurn?: () => void | Promise<void>;
    /** 可选：迁移 task-list 等附属文件 */
    migrateSidecars?: (sessionId: string, signal: AbortSignal) => Promise<void>;
    /**
     * job 记录一落盘（id 已知、行已能在列表里出现）就回调。
     *
     * 交接的重头（flush transcript、fork worker）在这之后才发生；
     * 调用方可以在这里就切换视图，让按键到画面切换只隔一次小文件写入，
     * 而不是等整条流水线跑完——那是秒级的画面冻结。
     */
    onJobCreated?: (id: string) => void;
    nowMs?: () => number;
    warn?: (message: string) => void;
}
export interface SessionHandoffInput {
    sessionId: string;
    cwd: string;
    messages: readonly HandoffSeedMessage[];
    via: Exclude<HandoffVia, 'detach'>;
    /** `/bg <prompt>` 附加指令 */
    extraPrompt?: string;
    /** abort-then-fork 时带走的未发完输入 */
    prefill?: string;
    boundaryUuid?: string;
    /** 要写进 adopt.json 的可搬走工作（通常已按 canCarry 过滤） */
    carryTasks?: readonly InFlightTask[];
    /** 透传给子进程的 flag（--model / --permission-mode 等） */
    inheritFlags?: readonly string[];
    /**
     * 交接时会话的实时权限模式。
     *
     * worker 是一个**新进程**，而权限模式只活在内存里：Shift+Tab 切换不落盘，
     * `--permission-mode` 也不一定出现在 argv 里。不带过去的话，转后台的瞬间
     * 模式就会从新进程重建出的默认值重新出发 —— auto 掉回 default，下一个
     * 需要批准的工具调用就卡在「等待输入」，表现为「auto mode 自己关了」。
     * 该值会覆盖 inheritFlags 里从 argv 回放出来的陈旧 --permission-mode。
     */
    permissionMode?: PermissionMode;
    /** 源 Session 已锁定隐私数据时，通过 M5 隐藏参数恢复到 worker。 */
    privateDataSticky?: true;
    /** 用户显式命名 */
    name?: string;
    /**
     * 左箭头允许空会话建行（seed 为 null 时用空 intent）。
     * `/bg` 应设为 false，让「还没消息」在外层被拒绝。
     */
    allowEmptySeed?: boolean;
    /**
     * fork 语义：这是一个副本，父会话继续存活。
     * 设置时会把关联字段写进 job 状态（design D8）。
     */
    fork?: {
        parentSessionId: string;
        sourceAlive: boolean;
    };
    /**
     * 已存在的 job 记录（原地 worker 化在建行时就创建并一直维护它）：
     * 跳过 create —— 重建会把刚落盘的 done/output 整个覆盖回 starting…，
     * 行上的完成态就丢了；spawn 后也只补 pid/logPath，不再写死状态，
     * settle 结果由建行方（become-worker）独写。spawn 失败也不回滚删除：
     * 记录描述的是一段真实存在的对话，不是本次交接的临时产物。
     */
    existingJobId?: string;
}
export type SessionHandoffResult = {
    ok: true;
    id: string;
    pid: number;
    logPath: string;
    seed: HandoffSeed;
} | {
    ok: false;
    reason: string;
};
/**
 * 从消息派生 job 的 intent / 显示名。
 * 对照 Claude `TKe`：没有用户消息且没有 extraPrompt → null。
 */
export declare function deriveHandoffSeed(messages: readonly HandoffSeedMessage[], extraPrompt?: string, emptyFallback?: string): HandoffSeed | null;
/**
 * 交接主流程。调用方负责之后切到 agent view。
 */
export declare function handOffSessionToBackground(deps: SessionHandoffDeps, input: SessionHandoffInput): Promise<SessionHandoffResult>;
/**
 * 把交接时的实时权限模式合并进 worker 启动 flag。
 *
 * 先剥掉 inheritFlags 里可能从 argv 回放出来的陈旧 `--permission-mode`
 * （会话开始后用户可能用 Shift+Tab 改过，argv 里的值已经不代表现状），
 * 再追加当前模式；spawn 与 respawnArgs 共用同一份结果，worker 重启后
 * 模式也不会丢。未提供模式时原样返回 inheritFlags。
 */
export declare function mergePermissionModeFlag(inheritFlags?: readonly string[], permissionMode?: PermissionMode): string[];
/**
 * 隐私锁定是无值布尔 flag，不能用会吞掉下一个 token 的键值 flag 替换逻辑。
 * 无论 inheritFlags 是否含旧值，都先剥离，再只对严格 true 追加一次。
 */
export declare function mergePrivateDataStickyFlag(inheritFlags: readonly string[], privateDataSticky?: true): string[];
/**
 * 后台 worker 的启动参数。
 *
 * worker 是 broker PTY 里的一个**完整交互会话**（不是 `--print`、也不是 `--serve`），
 * 它自己会一直活着；首个 prompt 作为位置参数交给启动流程消费，
 * 决定它一起来是接着干活还是就地待命。
 *
 * respawnArgs 刻意不带 prompt：重启时该说的话由 pendingReply 承担，
 * 带上会让同一条指令被执行两遍。
 */
export declare function buildResumeArgs(sessionId: string, inheritFlags?: readonly string[], firstPrompt?: string): string[];
