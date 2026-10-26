/**
 * 会话进程内的 job 状态汇报器。
 *
 * 这是 agent view 之所以能显示"它在干什么 / 在问什么 / 产出了什么"的唯一来源。
 * 只在被 agent view 或 `--bg` 拉起的进程里激活（靠 CODEBUDDY_JOB_ID 判定），
 * 普通交互会话完全不受影响。
 *
 * 顺带把 status / waitingFor 回填 PID 注册表 —— 在此之前
 * `registry.update({ status })` 在整个 src/ 里没有调用点，
 * 所以 `codebuddy ps` 的 STATUS 列一直显示 unknown。
 */
import { Application, ApplicationLifecycle } from '@celljs/core';
import { SessionRunStatus } from '../../vendor/cbc-core/node/index.js';
import { type SessionStatus } from '@genie/cbc-daemon';
import { type AgentJobLifecycle, type AgentJobTempo, type IJobStateReporter } from './agent-view-protocol';
/** 状态机相位映射到 job 状态的结果 */
export interface ReportedState {
    state: AgentJobLifecycle;
    tempo: AgentJobTempo;
    detail: string;
    /** 回填 PID 注册表的运行状态 */
    status: SessionStatus;
    /** status 为 waiting 时说明在等什么 */
    waitingFor?: string;
}
/**
 * 相位 → job 状态的映射表。
 *
 * 抽成纯函数是为了让"哪个相位算阻塞"这件事能被单测钉死：
 * 它直接决定一行会不会出现在 Needs input 分组里，错了用户就永远等不到提醒。
 */
export declare function mapRunStatus(status: SessionRunStatus): ReportedState;
export declare class JobStateReporterImpl implements IJobStateReporter, ApplicationLifecycle<Application> {
    private readonly store;
    private readonly sessionManager?;
    private readonly interruptionService?;
    private readonly stateMachine?;
    private readonly registry?;
    private readonly agentService?;
    private readonly logger;
    private subscriptions;
    /** 当前正在盯的会话，用于避免对同一个会话重复订阅 */
    private observedSessionId;
    /** 当前会话的相位订阅，换会话时要退掉 */
    private phaseSubscription;
    private historySubscription;
    private started;
    /** Keep phase observations in emission order across disk and registry awaits. */
    private reportTail;
    private titleTail;
    /** 上一次写盘的相位，用于抑制重复写 */
    private lastStatus;
    /** detail 的最近刷新时刻，用于 15 秒节流 */
    private lastDetailAt;
    /** 当前 busy 周期是否已收尾 */
    private terminalRecorded;
    /**
     * 本进程是否真的干过活。
     *
     * 只有"忙过之后回到 idle"才算一轮跑完；进程刚起来时状态机也是 IDLE，
     * 不加这个标记会把还没开始的会话直接标成 done。
     */
    private sawBusy;
    /**
     * 写入 done 时会话历史里的用户消息数。
     *
     * done 之后的家务（命名/摘要等也走同一台状态机）会把相位打回
     * busy，若不设防会把刚完成的行又吹回 working。真正的 follow-up
     * 必然新增用户消息，家务不会 —— 用这个计数区分两者。
     */
    private settledUserCount;
    /**
     * settle（recordTurnResult）正在进行：它自己有好几个 await，家务相位
     * 的 busy 写入可以整段插进去把刚落盘的 done 覆回 working（latch 还
     * 没来得及置位）。settle 期间所有常规写盘让路，结果由 settle 独写。
     */
    private settleInProgress;
    /**
     * 补写正在进行：防止 .finally() 中的补写 report() 在無任务会话下
     * 触发条件性无限循环（settle → latch cleared → finally → report →
     * busy 重置 terminalRecorded → 下次 IDLE 再 settle → 循环）。
     * 每个 settle 周期最多补写一次，补写后 terminalRecorded=true 阻止
     * 同周期再次进入 settle。
     */
    private reReportPending;
    /** 本回合开始时刻（busy 新回合时置位） */
    private turnStartMs;
    /** 回合开始时盘上已入账的结果：复用层用它区分新/旧输出 */
    private accountedAtTurnStart;
    /**
     * busy 转态瞬间盘上是否还是 done。busy 会把盘上 state 改成 working，
     * recordTurnResult 的「已完成行不降级」守卫依赖盘上 state==='done'——
     * 转态后必然失守，无文本 follow-up 会把上一轮 output.result 清成 null。
     * 用回合开始时的快照记忆兜底。
     */
    private wasDoneAtBusyStart;
    /** busy 事件异步落盘前，先用历史消息数识别确实收到了一条新追问。 */
    private userMessageAddedAtBusyStart;
    /** 上一次观察到 idle 时的用户消息数，用来封死 busy→idle 竞态。 */
    private lastIdleUserCount;
    /** IDLE 早于助手历史入账时，等待当前会话的新回答再结算。 */
    private waitingForAnswer;
    /** 本回合的 job 意图（prompt 构造用） */
    private intentAtTurnStart;
    /** 最近一次模型摘要（优先于复用层与相位短语） */
    private modelSummary;
    private lastModelAtMs;
    private summaryInFlight;
    get jobId(): string | undefined;
    initialize(): void;
    start(): void;
    stop(): Promise<void>;
    onStop(): Promise<void>;
    /**
     * 盯住一个会话的相位变化。
     *
     * `sessionSubject` 会把同一个会话重复推出来（compact、rename、
     * setCurrent 等都会触发）。每来一次就 `subscribe` 一次的话，订阅数只增不减，
     * 之后每次相位跃迁都会按订阅数成倍地写盘 —— 同一秒里几十次重复写，
     * agent view 那边读到的全是无变化的中间态。
     *
     * 所以：同一个会话只订阅一次；换会话时先把上一个退掉。
     */
    private observe;
    /**
     * 先落 job 状态、再试目录：网关认领时会在目录锁里读 job.title 补换名，
     * 这个先后保证标题与认领无论谁先到，占位名都会被换掉且只换一次。
     */
    private recordSessionTitle;
    private settleAfterAnswer;
    private report;
    private writeReport;
    private pendingMatchesSession;
    private pendingApprovalFor;
    /**
     * 从会话历史里采集 gh 命令点名的 PR，合并进 state.children。
     * 只在有新增时写盘；已有条目的 status/href 不被覆盖。
     */
    private maybeCollectPrLinks;
    /**
     * 回合结束时刷新已关联 PR 的状态（行尾标签颜色的数据源）。
     * fire-and-forget：gh 不在 / 未登录 / 网络失败都静默保留旧状态。
     */
    private maybeRefreshPrStatuses;
    /** RUN_FAILED ends the run without an answer but leaves the worker alive.
     * Do not turn an unsuccessful first prompt into a permanently "working/idle" row.
     * Keep any earlier successful output so a failed follow-up does not erase history.
     */
    private recordTurnFailure;
    private toFailureDetail;
    /**
     * 一轮跑完了：按「这个 job 有没有任务」决定终态。
     *
     * 派发型会话（有 initialPrompt / intent）：任务答完 = 完成，写 done +
     * firstTerminalAt（年龄冻结在耗时）。进程继续活着随时可答 follow-up，
     * 那时 busy 分支会把行拉回 working 并清 firstTerminalAt。官方文档的
     * Completed 示例行带存活图标 ✻ —— 完成与存活是正交维度，
     * 「进程退出才算 done」会让派发的任务永远到不了 Completed。
     *
     * 无任务会话（← 空行、/fork 无 prompt 副本）：回 working/idle，
     * 它只是在等下一句话，不该被标成做完。
     */
    private recordTurnResult;
    /**
     * 会话真的结束了（进程正在退出）：写终态。
     *
     * 终态只在这里产生。对齐 Claude 的 `settle()`（bundle 615687）——
     * 它的全部调用点都是进程 exit / kill / retire / pid 丢失。
     *
     * stop 是一次竞态：agent view 的 stop 先把状态写成 `stopped`，再给 broker
     * 发 SIGTERM，broker 杀掉 inner，inner 的退出钩子跑到这里。如果无条件写
     * `done`，用户刚按下的 stop 就会在列表上翻回「已完成」。已经落定的终结态
     * 由停它的那一方拥有，这里不抢。
     */
    private finish;
    /**
     * 复用层：本回合产生了新的助手文本才用它当 detail。
     * 恢复出来的旧答案（与回合开始时已入账的相同）不算 ——
     * 否则 resume 后的 busy 行会一直挂着上一轮的结论。
     */
    private sessionTextDetail;
    /**
     * 模型层：长回合才发（回合满 3 分钟），之后按同样间隔刷新。
     * 失败静默保留旧 detail；先记时间再发，失败也不会高频重试。
     */
    private maybeRequestModelSummary;
    private patchCurrent;
    /** 别人（stop / 失败路径）已经把终态写好了，就别再覆盖 */
    private hasSettledElsewhere;
    /**
     * settle 后的写盘门闩：done 已入账且没有新的用户消息。
     * 必须是同步函数，调用点要把它与 store.patch 放在同一个同步块里，
     * 才能与 recordTurnResult 的同步 latch 赋值互斥（否则晚到的相位补丁
     * 会把刚落盘的 done 覆回 working）。
     */
    private isSettleLatched;
    /** 当前会话历史里的用户消息数（follow-up 判定用） */
    private countUserMessages;
    private hasAnswerAfterLastUser;
    /** 当前会话历史里最后一条助手回答，用作行内结果摘要 */
    private lastAnswer;
}
