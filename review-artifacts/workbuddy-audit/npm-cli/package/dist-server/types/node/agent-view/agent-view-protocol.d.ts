/**
 * Agent View 模块协议定义
 *
 * 遵循项目 protocol pattern：所有 DI Symbol、类型与常量集中在此文件，
 * 实现类在独立文件中 import 这些定义。
 *
 * 设计依据来自对本地 Claude Code v2.1.216 原生二进制的拆包分析
 * （见 openspec/changes/add-agent-view/design.md，常量后附 bundle 行号）。
 */
export declare const JobStore: unique symbol;
export declare const JobStateReporter: unique symbol;
export declare const JobTerminalBroker: unique symbol;
export declare const JobInboxConsumer: unique symbol;
/** worker 启动时消费 adopt.json 的生命周期组件 */
export declare const JobAdoptConsumer: unique symbol;
export declare const JobOrphanWatchdog: unique symbol;
/** 后台会话进程通过此变量得知自己对应哪个 job 目录 */
export declare const ENV_JOB_ID = "CODEBUDDY_JOB_ID";
/** inner worker 所属的 outer broker 代次（broker PID）。 */
export declare const ENV_JOB_GENERATION = "CODEBUDDY_JOB_GENERATION";
/** Internal one-shot authority for a reserved worker launch. */
export declare const ENV_JOB_LAUNCH_TOKEN = "CODEBUDDY_JOB_LAUNCH_TOKEN";
/**
 * job 目录的绝对路径，供会话里的 shell 命令使用（对齐 Claude 的
 * CLAUDE_JOB_DIR）：并行会话各自往 `$CODEBUDDY_JOB_DIR/tmp` 写临时文件，
 * 互不碰撞。与身份三件套不同，它是给用户命令用的，**不在**
 * job-identity 的 scrub 名单里，会一路继承到 shell 子进程。
 */
export declare const ENV_JOB_DIR = "CODEBUDDY_JOB_DIR";
/** 设置该变量（任意非空值）即整体关闭 agent view */
export declare const ENV_DISABLE_AGENT_VIEW = "CODEBUDDY_CODE_DISABLE_AGENT_VIEW";
/** 打开 agent view 时预选中的 job short id（← 交接后传入） */
export declare const ENV_AGENTS_SELECT = "CODEBUDDY_AGENTS_SELECT";
/**
 * attach 的来源标记：从 agent view attach 进来的会话，detach（←）后应回 agent view；
 * 从 shell 直接 attach 的则回 shell（对照 Claude `pendingAgentViewAttach`）。
 */
export declare const ENV_ATTACH_ORIGIN = "CODEBUDDY_ATTACH_ORIGIN";
/** detached 外层进程以 PTY broker 模式托管完整交互会话 */
export declare const ENV_JOB_BROKER = "CODEBUDDY_JOB_BROKER";
/** detached 外层进程直接运行完整交互会话，不加载 PTY broker */
export declare const ENV_JOB_HEADLESS = "CODEBUDDY_JOB_HEADLESS";
/** broker 内层交互进程连接的本地控制 socket */
export declare const ENV_JOB_CONTROL_SOCKET = "CODEBUDDY_JOB_CONTROL_SOCKET";
/**
 * agent view 里按 Esc 时要回到的那个后台会话。
 *
 * 刻意与 {@link ENV_AGENTS_SELECT} 分开：后者只表示「列表打开时高亮哪一行」，
 * 是纯展示语义；一个 job 可以被预选中却不是 Esc 的返回目标（例如 detach 后
 * 重新打开列表——那时应该停在刚才那一行，但 Esc 该回 shell 而不是又 attach 回去）。
 * 两个语义共用一个变量时，「detach → Esc」会立刻把用户弹回刚离开的会话。
 */
export declare const ENV_AGENTS_RETURN_JOB = "CODEBUDDY_AGENTS_RETURN_JOB";
/**
 * 列表刚打开时要显示的一条提示（通常是上一次 attach 失败的原因）。
 *
 * attach 发生在 Ink 卸载之后，那时 `console.log` 只会把字打到 scrollback：
 * 它落在重绘出来的列表上方，与失败的那一行毫无关联，用户读到的是
 * 「按了回车没反应，上面多了一行莫名其妙的字」。所以把原因交给
 * 新进程，由它画进列表内部。对齐 bundle 908398 的 `initialError`。
 */
export declare const ENV_AGENTS_NOTICE = "CODEBUDDY_AGENTS_NOTICE";
/** `ENV_ATTACH_ORIGIN` 的取值 */
export declare const ATTACH_ORIGIN_AGENT_VIEW = "agent-view";
/** jobs 根目录名（位于 PathUtils.getHomeDir() 下） */
export declare const JOBS_DIR_NAME = "jobs";
/** 每个 job 的状态文件名 */
export declare const JOB_STATE_FILE = "state.json";
/**
 * Job mutation lock suffix, stored at jobs/.locks/<id>.state.lock.
 * Exclusive creation serializes create/patch/remove across processes even when
 * the job directory is deleted. A recoverable directory guard serializes acquisition
 * and dead-owner recovery; the file still excludes legacy writers. Live or unknown
 * owners are never evicted based on age, and contention times out without writing.
 */
export declare const JOB_STATE_LOCK_FILE = "state.lock";
/**
 * 每个 job 的临时目录名：会话里的 shell 命令可往
 * `$CODEBUDDY_JOB_DIR/tmp` 写草稿，随 job 删除一起清理。
 */
export declare const JOB_TMP_DIR = "tmp";
/**
 * sidecar：broker 专属的连接端点（pid + attachSocket）。
 *
 * 单独一个文件而不是写进 state.json：state.json 同时被 broker 进程和
 * inner worker 的 reporter 高频写，两个进程各自读-合并-写会互相覆盖
 * （进程内的 writeMutex 拦不住跨进程的 lost update），attachSocket
 * 被抹掉后 attach 会报 ENOTREADY。各进程只写自己拥有的文件就没有合并竞态。
 */
export declare const JOB_BROKER_FILE = "broker.json";
/** 转后台时落盘的 adopt 清单（可搬走的在跑工作 + abort 预填） */
export declare const JOB_ADOPT_FILE = "adopt.json";
/** sidecar：手动排序值（目录分组模式下生效） */
export declare const JOB_ORDER_FILE = "order";
/** sidecar：手动排序值（状态分组模式下生效） */
export declare const JOB_STATE_ORDER_FILE = "stateOrder";
/** sidecar：用户自定义分组名 */
export declare const JOB_GROUP_FILE = "group";
/** jobs 根目录下的全局置顶集合 */
export declare const JOB_PINS_FILE = "pins.json";
/** 每个 job 的回复收件箱目录 */
export declare const JOB_INBOX_DIR = "inbox";
/** 投递失败后暂存的回复，会话下次启动时作为首个 prompt 消费 */
export declare const JOB_PENDING_REPLY_FILE = "pending-reply.json";
/** job 目录名长度：会话 UUID 的前 8 位 */
export declare const JOB_SHORT_ID_LENGTH = 8;
/**
 * 任务生命周期状态。
 *
 * 与 tempo 正交：state 描述"任务走到哪一步"，tempo 描述"现在是否真的在动"。
 * 只有两者结合才能表达"已完成但又被追问一句所以重新活跃"这种状态。
 */
export type AgentJobLifecycle = 'working' | 'blocked' | 'done' | 'failed' | 'stopped';
/** 活跃度。terminal state + tempo !== 'active' 才算真正终结 */
export type AgentJobTempo = 'active' | 'idle' | 'blocked';
/** 终结产出。null 表示尚未终结 */
export type AgentJobOutcome = 'success' | 'failure' | 'stopped' | null;
/** UI 波段——决定图标形态与颜色 */
export type AgentJobBand = 'active' | 'blocked' | 'completed';
/** 状态分组键——决定落在哪个分组标题下 */
export type AgentJobStateGroup = 'review' | 'blocked' | 'working' | 'done';
/** 列表分组维度，Ctrl+S 在两者间切换 */
export type AgentViewGroupMode = 'state' | 'directory';
/** 处于终结生命周期的 state 集合（不含 tempo 判定） */
export declare const TERMINAL_LIFECYCLES: readonly AgentJobLifecycle[];
/** 阻塞时给出的一个预设选项 */
export interface AgentJobQuestionOption {
    label: string;
    description?: string;
}
/** 阻塞时正在问的一个问题 */
export interface AgentJobQuestion {
    question: string;
    options?: AgentJobQuestionOption[];
}
/** 关联的外部产出（当前只有 PR，预留 kind 便于扩展） */
export interface AgentJobLink {
    kind: 'pr';
    /** PR 编号 */
    number: number;
    /** 可点击的 URL */
    href?: string;
    /** PR 状态，决定标签颜色 */
    status?: 'open' | 'checks-failed' | 'checks-passed' | 'merged' | 'draft' | 'closed';
}
/**
 * 持久化到 `~/.codebuddy/jobs/<shortId>/state.json` 的 job 状态。
 *
 * 注意：pinned / sortOrder / stateSortOrder / group 这四个纯展示字段
 * **不属于本结构**，它们由 agent view 单方面拥有并存在 sidecar 文件中，
 * 否则会话进程每次汇报状态都会把用户的摆放覆盖回去。
 */
export interface AgentJobState {
    /** 任务生命周期 */
    state: AgentJobLifecycle;
    /** 一句话摘要，渲染在行内 */
    detail: string;
    /** 活跃度 */
    tempo: AgentJobTempo;
    /** 阻塞时的问题原文 */
    needs?: string;
    /** 阻塞时的结构化问题与选项 */
    block?: {
        questions: AgentJobQuestion[];
    };
    /** 阻塞时可供 Tab 一键填入的建议回复 */
    suggestedReply?: string;
    /** 终结时的结果文本（键为分段名，便于未来扩展多段结果） */
    output?: Record<string, string> | null;
    /** 关联的 PR 等外部产出 */
    children?: AgentJobLink[] | null;
    /** 用户原始 prompt，用于 URL 过滤与兜底命名 */
    intent: string;
    /** 覆盖行内展示用的意图文本 */
    displayIntent?: string;
    /** 会话启动时要消费的首个 prompt */
    initialPrompt?: string;
    /** 已排队但尚未发送的 prompt */
    queuedPrompt?: string;
    /** 会话显示名 */
    name?: string;
    /** 名字来源：用户显式命名还是自动生成 */
    nameSource?: 'user' | 'auto';
    /** 主会话最近一次生成的 AI 标题（job 进程写）；Agent Home 用它给占位名的智能体转正 */
    title?: string;
    /** 会话主题色（对齐 /color 的语义） */
    color?: string;
    /** 完整会话 UUID */
    sessionId: string;
    /**
     * 这个 job 最初派发/绑定的会话 id，**永不被会话切换改写**。
     *
     * 派发首句（intent/initialPrompt）只属于这条会话。`sessionId` 会在用户在
     * 智能体内 new/load 会话后被 `bindJobWorkerSession` 改写（inbox 要投给新会话），
     * 因此不能用它判断「首句还属不属于当前会话」——Web UI 曾据此把旧首句补种进
     * 新会话（真机现场：新建会话后上一条用户消息永久残留）。
     */
    initialSessionId?: string;
    /** UI 当前选中的会话；跨浏览器/刷新恢复，默认回落到 sessionId */
    selectedSessionId?: string;
    /** 会话 UUID 前 8 位，等于 job 目录名 */
    shortId: string;
    /** 写入该状态的 CLI 版本 */
    cliVersion?: string;
    /**
     * 最近一次 attach recap 的幂等键（M12）：同一条进展只在 attach
     * 时播报一次，反复进出不刷屏。
     */
    lastRecapKey?: string;
    /** 会话启动时的工作目录 */
    cwd: string;
    /** ISO 时间戳 */
    createdAt: string;
    /** ISO 时间戳 */
    updatedAt: string;
    /** 首次进入终结态的 ISO 时间戳，年龄列据此冻结 */
    firstTerminalAt?: string | null;
    /**
     * 最近一次进入空闲的 ISO 时间戳。只在 busy→idle / stop 时写入，
     * 后续 idle 补丁不得刷新。reaper 用它回收仍活着的空闲 worker。
     */
    idleSince?: string | null;
    /**
     * 最近一次真实对话活动（回合开始 / 回合进行中）的 ISO 时间戳，列表按它排「最近活跃」。
     * 只由 worker 的忙碌相位写入；重启、预热、回收、心跳都不推进它——updatedAt/idleSince
     * 会被这些生命周期写顺带刷新，拿它们排序会让仅仅恢复过的智能体跳到列表顶部。
     * 旧记录缺省时由生命周期写入方用 {@link carryLastActivity} 补上原值。
     */
    lastActivityAt?: string | null;
    /**
     * 最近一次 attach 的起始时间（ISO）。attach 期间置位、detach/会话结束时
     * 清空。reaper 对终结 job 回收 worker 时用它做「正在被使用」守卫：
     * attachedAt 有效且 broker 存活 → 跳过，避免把正在服务的 broker 杀掉。
     */
    attachedAt?: string | null;
    /** 下次计划执行的时间戳（ms），用于渲染 `in 4m` */
    nextRunAt?: number;
    /** 该 job 已执行的轮次（排期任务用） */
    runCount?: number;
    /** 会话被移入的 worktree 路径 */
    worktreePath?: string;
    /** worktree 对应分支 */
    worktreeBranch?: string;
    /** 会话最初启动的目录（移入 worktree 前） */
    originCwd?: string;
    /** 该仓库的后台隔离模式 */
    bgIsolation?: 'none' | 'worktree';
    /** broker 进程 PID（可能已退出） */
    pid?: number;
    /**
     * broker 进程启动时刻（ISO）。与 pid 一起区分 PID 复用：
     * stop / reaper 在发信号或判定存活前比对；缺省时回退到 kill(0)。
     */
    procStart?: string | null;
    /** Windows FILETIME 启动时刻（与 procStart 同源，跨精度比对） */
    procStartFt?: string | null;
    /** Linux /proc/<pid>/stat 启动 tick；直接读取内核状态，不派生 ps 子进程。 */
    procStartTicks?: string | null;
    /** 支持代次强匹配的新 worker；值为启动该 inner 的 broker PID。 */
    workerGeneration?: number;
    /** Internal launch reservation; never exposed in public job DTOs. */
    workerLaunchToken?: string;
    /** Inner-owned shutdown barrier; pending inbox delivery must wake a replacement. */
    workerReclaimGeneration?: number;
    /** Reservation owner, used only for conservative dead-owner recovery. */
    workerLaunchOwnerPid?: number;
    /**
     * 重拉中标记：respawn 期间 stopWorker 会先写 `state:'stopped'` 作为**中间态**，
     * 但投递/唤醒票那一侧把 `stopped` 读成「用户终止过」→ 信不落盘、唤醒票被丢，
     * 恰好落在这个窗口里的消息就永久消失了。有这个标记时两侧都按"非用户终止"处理。
     */
    restarting?: boolean;
    /** broker 的本地 attach socket */
    attachSocket?: string;
    /** 会话输出日志路径 */
    logPath?: string;
    /** respawn 时需要原样回放的 CLI 参数 */
    respawnArgs?: string[];
    /**
     * 这件活在**哪个主会话**里被起（或被叫起来）的。Agent Home 的同事回投主 Agent 时
     * 按它寻址（信落在那个会话的上下文里），见 agent-home-main-mail-gate.ts。
     * 只在 Agent Home 侧写；不带 = 没地址，信按"活跃会话"启发式投。
     */
    originSessionId?: string;
    /** 这是一个 shell job（`!` 前缀派发）而非模型会话 */
    exec?: string;
    /** 删除被拒绝时的原因，渲染为行内 `not deleted` 提示 */
    notDeletedReason?: string;
    /**
     * 原地 worker 化进行中：前台进程没有退出，正把当前轮自然跑完
     * （见 become-worker.ts）。这段窗口里进程存活但**没有 broker PTY**，
     * attach 物理上接不通 —— 读侧看到「inPlaceWorker + 进程存活 + 无
     * attachSocket」应立即给出 ATTACH_FINISHING_MESSAGE，而不是让 broker
     * 的 10s 就绪轮询把一次回车拖成假死。轮次结束、idle-fork 出正式
     * worker 之前由原进程清为 false。
     */
    inPlaceWorker?: boolean;
    /**
     * 前台持有中：这段对话正在某个终端的前台进程里进行（← 落盘建行，
     * 对齐 Claude「← 即转后台、跨终端可见」的可见性语义，见
     * foreground-session-record.ts）。它没有 broker PTY，他端 attach 应立即
     * 给出 ATTACH_FOREGROUND_MESSAGE；Esc 回对话（撤销切换）时整行删除，
     * 交接成真后台 worker 时由新记录覆盖。
     */
    foregroundHeld?: boolean;
    /** fork 出这个副本时，父会话是否仍在前台存活 */
    forkSourceAlive?: boolean;
    /** fork 发生时的边界时间戳（ms），用于区分「副本继承到哪一句」 */
    forkBoundaryAt?: number;
    /** 副本自己的会话 id（与 sessionId 相同，显式记录便于关联查询） */
    forkSessionId?: string;
    /** 被 fork 的父会话 id */
    forkParentSessionId?: string;
}
/** 创建 job 时的必填输入，其余字段由 store 补默认值 */
export interface AgentJobInit {
    sessionId: string;
    cwd: string;
    intent: string;
    name?: string;
    nameSource?: 'user' | 'auto';
    detail?: string;
    pid?: number;
    logPath?: string;
    respawnArgs?: string[];
    exec?: string;
    bgIsolation?: 'none' | 'worktree';
    initialPrompt?: string;
    /** 原地 worker 化建行：见 AgentJobState.inPlaceWorker */
    inPlaceWorker?: boolean;
    /** 前台持有建行：见 AgentJobState.foregroundHeld */
    foregroundHeld?: boolean;
}
/** agent view 读到的展示字段（来自 sidecar，不在 state.json 里） */
export interface AgentJobDisplayMeta {
    pinned?: boolean;
    sortOrder?: number;
    stateSortOrder?: number;
    group?: string;
}
/** 进程存活信息，来自 PID 注册表 + kill -0 */
export interface AgentJobLiveness {
    /** 判活所用的进程；可能是注册表中的 inner worker，而非 state.pid 对应的 broker。 */
    pid?: number;
    /** 进程是否存活 */
    alive: boolean;
    /** 注册表汇报的运行状态 */
    status?: 'busy' | 'idle' | 'waiting' | 'stopped';
    /** status 为 waiting 时说明在等什么 */
    waitingFor?: string;
}
/**
 * 视图对象：job 状态 + 展示字段 + 进程存活合并后的结果。
 * 渲染层与视图模型只消费这个类型，不直接读文件。
 */
export interface AgentJobView {
    id: string;
    /** 进程内前台会话的临时投影，不可通过磁盘 job 操作。 */
    origin?: 'in-process';
    state: AgentJobState;
    display: AgentJobDisplayMeta;
    live: AgentJobLiveness;
}
/** 待投递的回复 */
export interface AgentJobReply {
    text: string;
    /** true 表示以 Bash 命令执行而非普通 prompt */
    bash?: boolean;
    /** 写入时间戳（ms） */
    at: number;
}
export interface AgentJobInboxStatus {
    queued: number;
    processing: number;
    oldestAt?: number;
}
/** broker 登记的连接端点，落在 JOB_BROKER_FILE sidecar 里 */
export interface JobBrokerEndpoint {
    /** broker 进程 pid，读侧用它判断端点是否仍然有效 */
    pid: number;
    /** broker 监听的 attach socket 路径 */
    attachSocket: string;
    /** broker 进程启动身份（可选；与 AgentJobState.procStart* 同源） */
    procStart?: string;
    procStartFt?: string;
    procStartTicks?: string;
}
/** job 状态文件与 sidecar 的读写 */
export interface IJobStore {
    /** jobs 根目录绝对路径 */
    getJobsDir(): string;
    /** 单个 job 目录绝对路径 */
    getJobDir(id: string): string;
    /** 创建 job 目录与初始状态文件，返回 shortId */
    create(init: AgentJobInit): Promise<string>;
    /** 读取单个 job 状态；损坏或缺字段返回 undefined */
    read(id: string): Promise<AgentJobState | undefined>;
    /** 浅合并写入；自动更新 updatedAt，自动剔除 UI-only 字段 */
    patch(id: string, partial: Partial<AgentJobState>): Promise<void>;
    /**
     * 浅合并写入，但**不触发**写侧死会话收割（patch 的 maybeReapDeadJobs）。
     *
     * 用于 attach 生命周期标记（attachedAt / lastRecapKey）：这些 patch 发生
     * 在 attach 进行中，若触发全量 reap，会把「done + alive + 超 TTL」的、
     * 正在被本进程接管的 broker 自己杀掉（A1 评审 blocker）。
     */
    patchQuiet(id: string, partial: Partial<AgentJobState>): Promise<void>;
    /** Conditional patch under the job lock; false if missing or superseded. Does not trigger reaping; I/O errors reject. */
    patchIf(id: string, partial: Partial<AgentJobState>, predicate: (state: AgentJobState) => boolean): Promise<boolean>;
    /** 列出全部可读 job（含展示字段），跳过损坏条目。读取可取消且有界并发。 */
    list(options?: JobListOptions): Promise<Array<{
        id: string;
        state: AgentJobState;
        display: AgentJobDisplayMeta;
    }>>;
    /** 删除 job 目录 */
    remove(id: string): Promise<void>;
    /** Conditional removal under the job lock; false if missing or superseded. I/O errors reject. */
    removeIf(id: string, predicate: (state: AgentJobState) => boolean): Promise<boolean>;
    /** 读取全局置顶集合 */
    readPins(): Promise<Set<string>>;
    /** 置顶或取消置顶 */
    setPinned(id: string, pinned: boolean): Promise<void>;
    /** 写入手动排序值；mode 决定落到哪个 sidecar */
    setOrder(id: string, mode: AgentViewGroupMode, order: number | undefined): Promise<void>;
    /** 写入自定义分组名；传 undefined 清除 */
    setGroup(id: string, group: string | undefined): Promise<void>;
    /** 投递一条回复到收件箱 */
    enqueueReply(id: string, reply: Omit<AgentJobReply, 'at'>): Promise<void>;
    /** 只读收件箱阶段快照，用于诊断长期等待；不认领、不修改文件。 */
    inspectInbox?(id: string): Promise<AgentJobInboxStatus>;
    commitReclaim?(id: string, expected: AgentJobState): Promise<boolean>;
    /**
     * 认领收件箱（两阶段投递的第一阶段）：把待处理项移进 `inbox/.processing/` 并返回。
     * **不再删除**——调用方处理成功后必须 ackInbox，失败/中断则 releaseInbox（或直接
     * 等下一轮 drain 再取，认领目录里的残留会被重新取走）。这样"已读未处理"是盘上的显式状态，
     * 崩溃不再丢信（at-least-once；重复由回执判重吸收）。
     */
    drainInbox(id: string): Promise<AgentJobReply[]>;
    /** 确认这一批已处理：清掉 `inbox/.processing/`。实现可选，缺省表示旧语义。 */
    ackInbox?(id: string): Promise<void>;
    /** 这一批没处理成功：放回 `inbox/`，下一轮再取（保序、不丢）。 */
    releaseInbox?(id: string): Promise<void>;
    /** 暂存投递失败的回复（bash 回复不允许暂存） */
    savePendingReply(id: string, reply: Omit<AgentJobReply, 'at'>): Promise<boolean>;
    /** 仅当没有待恢复回复时暂存；用于恢复中避免覆盖并发到达的新输入。 */
    savePendingReplyIfAbsent(id: string, reply: Omit<AgentJobReply, 'at'>): Promise<boolean>;
    /** 只读暂存回复（不删除）。respawn 需要先读后 fork、成功后再消费，避免 fork 失败丢回复 */
    readPendingReply(id: string): Promise<AgentJobReply | undefined>;
    /** 取出并清除暂存回复；expected 存在时仅消费同一条回复，保留并发新写入。 */
    takePendingReply(id: string, expected?: AgentJobReply): Promise<AgentJobReply | undefined>;
    /**
     * 登记 / 清除 broker 连接端点（写 JOB_BROKER_FILE sidecar）。
     *
     * 只该由 broker 进程调用：它是这个文件唯一的写方，
     * 与 reporter 高频写的 state.json 彻底隔离。
     * When expected is provided, mutate only if the current sidecar matches its PID and socket.
     */
    setBrokerEndpoint(id: string, endpoint: JobBrokerEndpoint | undefined, expected?: JobBrokerEndpoint): Promise<void>;
}
/** Read-side controls for large job directories; does not introduce another state source. */
export interface JobListOptions {
    signal?: AbortSignal;
    /** Maximum number of job directories read concurrently. Defaults to the native safe cap. */
    concurrency?: number;
}
export interface JobAttachResult {
    outcome: 'detached' | 'exited' | 'error';
    code?: number;
    message?: string;
}
/**
 * `prepareAttach` 的产物：已经把「慢的部分」（解析/重启 worker、等 socket
 * 就绪、重读盘上状态）做完，握着一个可以立刻 pipe 的 socket。
 *
 * 拆成两步是为了消除切换黑屏：这些慢操作（可能 poll 到数秒）此前跑在
 * 「Ink 已卸载、终端全黑」的真空期里，黑屏时长 = 连接耗时。把它提到卸载
 * **之前**（Ink 还在正常渲染时）完成，卸载后只剩真正的终端接管（快）。
 */
export type PreparedAttach = {
    ok: true;
    socketPath: string;
    job: AgentJobView;
} | {
    ok: false;
    message: string;
};
/** broker 控制协议的请求。每条请求是一行 JSON。 */
export declare const JOB_CONTROL_PROTOCOL_VERSION = 1;
export type JobControlRequest = {
    protocolVersion?: number;
} & ({
    op: 'attach';
    cols?: number;
    rows?: number;
} | {
    op: 'detach';
} | {
    op: 'resize';
    cols?: number;
    rows?: number;
} | {
    op: 'ping';
} | {
    op: 'request-reclaim';
    token?: string;
    reason?: 'memory-pressure' | 'stale-state-probe';
    pid: number;
    workerGeneration: number;
    sessionId: string;
    createdAt: string;
    idleSince?: string | null;
    firstTerminalAt?: string | null;
}
/** @deprecated Broker rejects with ENOTREADY; use `request-reclaim`. Kept so old clients get a clear refusal. */
 | {
    op: 'reclaim';
    reason?: 'memory-pressure';
    pid: number;
    workerGeneration: number;
    sessionId: string;
    createdAt: string;
    idleSince?: string | null;
    firstTerminalAt?: string | null;
});
/** broker 控制协议的应答。同样是一行 JSON。 */
export interface JobControlResponse {
    protocolVersion?: number;
    ok: boolean;
    error?: string;
    code?: JobControlErrorCode;
}
export type JobControlErrorCode = 'EBADREQ' | 'ETOOLARGE' | 'ENOJOB' | 'ENOTREADY' | 'EEXEC';
export interface IJobTerminalBroker {
    /** 以 broker 身份托管一个完整交互会话，直到内层进程退出 */
    run(): Promise<void>;
    /** 把当前终端接到某个后台会话的 PTY 上，直到 detach 或对端退出 */
    attach(job: AgentJobView): Promise<JobAttachResult>;
    /**
     * 只做 attach 的「慢准备」——解析/重启 worker、等 socket 就绪、重读状态——
     * 不接管终端。可在 Ink 还挂着时调用，把连接耗时挪出切换黑屏窗口。
     */
    prepareAttach(job: AgentJobView): Promise<PreparedAttach>;
    /** 用已 prepare 好的 socket 直接接管终端（跳过慢准备）。终端此刻必须已交还。 */
    attachPrepared(prepared: Extract<PreparedAttach, {
        ok: true;
    }>): Promise<JobAttachResult>;
    /** 内层会话请求把 attacher 踢开（← / Ctrl+Z / /exit），worker 继续存活 */
    requestDetach(): Promise<boolean>;
}
/**
 * 「pid 还没写进 job 记录」的宽限期。
 *
 * 早切视图后，← 交接建出的行会先于 fork 完成出现在列表里；这段窗口内
 * attach 不能走 respawn——那会和在途 fork 双开同一个 session。
 */
export declare const ATTACH_SPAWN_GRACE_MS = 30000;
/** attach 时 socket 还没就绪 */
export declare const ATTACH_NOT_READY_MESSAGE = "Session is starting \u2014 it will appear once ready. Press enter to try again.";
/**
 * 这个 worker 从没起过 broker（Web UI / 自动化 / SDK 起的 headless 会话）。
 *
 * 它进程还活着、也一直在干活，但**没有 PTY**：attach 永远等不到 socket。
 * 以前这里会走「就绪轮询」，把一次回车拖成 10s 的假死；现在直接说清楚
 * 为什么进不去，而不是让人以为按键坏了。
 */
export declare const ATTACH_NO_TERMINAL_MESSAGE = "This session runs without a terminal (started by Web UI or automation) \u2014 it can't be opened here. Press esc to go back.";
/**
 * 会话进程已经不在了，正在按 `--resume` 重新拉起。
 *
 * Claude 的语义是**透明重启再接管**（bundle 762520 附近的
 * `tengu_bg_attach_legacy_autorespawn`），而不是甩用户一句「它没了」：
 * transcript 一直在盘上，会话本来就该能从断点续起。
 */
export declare const ATTACH_RESTARTING_MESSAGE = "Session had exited \u2014 restarting it and restoring the conversation\u2026";
/** 重启也失败了：说清楚对话还在，以及怎么捞回来 */
export declare const ATTACH_RESTART_FAILED_MESSAGE = "Couldn't restart this session \u2014 its conversation is still available via 'codebuddy --resume'";
/** attach 目标已经不在，且不适合自动重启 */
export declare const ATTACH_NO_JOB_MESSAGE = "Session is no longer running";
/** shell job 不是交互会话，没有可接管的 PTY */
export declare const ATTACH_EXEC_MESSAGE = "This is a shell command, not a session \u2014 press space to peek at its output";
/**
 * 原地 worker 化期间的行内摘要（become-worker.ts）。
 *
 * 这段窗口里没有 broker PTY，attach 物理上接不通 —— 文案必须同时说清
 * 「它还在干活」与「什么时候能进去」，否则用户对着一行 working 反复回车。
 */
export declare const FINISHING_TURN_DETAIL = "finishing the current turn \u2014 attach when done";
/** attach 一个还在原地收尾当前轮的会话时的拒绝文案（预期内，非故障） */
export declare const ATTACH_FINISHING_MESSAGE = "Session is finishing its current turn \u2014 it will be attachable when the turn ends";
/**
 * 他端 attach 一个正在另一个终端前台进行的对话时的拒绝文案。
 *
 * 前台持有的会话没有 broker PTY，接不通属预期；文案要说清它在哪、
 * 怎么才能接（那边把它转后台，或等它退出后 respawn）。
 */
export declare const ATTACH_FOREGROUND_MESSAGE = "Session is open in another terminal's foreground \u2014 background it there to attach here";
/** 接上了但屏幕还没重绘出来 */
export declare const ATTACH_WAITING_REDRAW_MESSAGE = "Waiting for session to redraw\u2026 Ctrl+Z to detach";
/** 同一个会话在别处被接管，本连接被替换 */
export declare const ATTACH_KICKED_MESSAGE = "Session opened in another window \u2014 this view was detached";
/** 平台没有 PTY，后台会话无法常驻 */
export declare const BROKER_NO_PTY_MESSAGE = "Background sessions need a PTY, which is unavailable on this platform";
/**
 * `!command` 回复送不进一个正在跑的会话。
 *
 * `!` 是输入框层面的语法，会话层没有对应通道；当成普通文本发过去，
 * 「执行命令」就悄悄变成了「说了句话」。宁可明说也不要静默错误。
 */
export declare const REPLY_BASH_NEEDS_ATTACH_MESSAGE = "Bash replies only run inside the session \u2014 press enter to attach and run it there";
/** 会话进程内的状态汇报器 */
export interface IJobStateReporter {
    /** 若当前进程不是后台 job 则为 no-op */
    start(): void;
    /** 停止汇报并落盘最终状态 */
    stop(): Promise<void>;
    /** 当前进程对应的 job id（非 job 进程为 undefined） */
    readonly jobId: string | undefined;
}
/**
 * 存活图标：工作中与静止都用这一个字形。
 *
 * 工作中的动画用颜色明暗脉冲而不是换字形（见 resolveIconPulseDim）：
 * 换字形的帧序列只要有任意一帧在用户终端里被画成 2 格（EAW Ambiguous
 * 双宽、emoji 呈现、字体差异都可能），图标右侧整行就会随动画左右横跳；
 * 颜色码不占列宽，任何终端下都绝对稳定。
 */
export declare const ICON_ALIVE = "\u273B";
/** 进程已退出——仍可 peek / 回复 / 接管，会话会从断点续起 */
export declare const ICON_DEAD = "\u2219";
/** 排期中（loop 会话在两轮之间休眠） */
export declare const ICON_SCHEDULED = "\u2722";
/**
 * 等待用户输入的图标。
 *
 * 语义优先级高于 `ICON_DEAD`：一个「进程已退、但在等你回答」的会话
 * 首先是在等你——用死点表示会让最需要处理的行长着最不起眼的脸。
 */
export declare const ICON_BLOCKED = "?";
/**
 * 终结产出的形状编码：✓ 成功 / ✗ 失败（stopped 沿用死点）。
 * 颜色（success/error）之外再用形状区分一次——色盲终端下也能分诊。
 * 两个字形均属 East-Asian-Neutral（单格），不会触发 Ambiguous 双宽问题。
 */
export declare const ICON_DONE_OK = "\u2713";
export declare const ICON_DONE_FAIL = "\u2717";
/** 选中行前缀标记 */
export declare const ROW_SELECTION_MARKER = "\u276F";
/** 分组标题的展开/折叠指示符（两种状态都渲染，标题不再左右横跳） */
export declare const GROUP_GLYPH_COLLAPSED = "\u25B8";
export declare const GROUP_GLYPH_EXPANDED = "\u25BE";
/** 状态分组的渲染顺序。对齐 bundle 908750 的 `Lti` */
export declare const STATE_GROUP_ORDER: readonly AgentJobStateGroup[];
/** 状态分组标题。对齐 bundle 908752 的 `qSt` */
export declare const STATE_GROUP_LABELS: Record<AgentJobStateGroup, string>;
/** 空态时分组标题下的说明行。对齐 bundle 908758 的 `ISS` */
export declare const STATE_GROUP_DESCRIPTIONS: Record<AgentJobStateGroup, string>;
/** 置顶分组标题 */
export declare const PINNED_GROUP_LABEL = "Pinned";
/** 目录分组模式下无法归属仓库时的分组名 */
export declare const UNGROUPED_GROUP_LABEL = "(ungrouped)";
/**
 * 从 `←` 交接进来时，列表顶部的上下文说明。
 *
 * 用户刚被从一个正在进行的对话里带走，屏幕整个换了 —— 得先说清楚
 * 「刚才那个会话去哪了、怎么回去」，否则很容易以为会话被关掉了。
 *
 * 文案取自 Claude Code v2.1.218 的实际界面（用户提供的截图）。
 * 本地的两个 recovery bundle 是 2.1.216 / 2.1.210，里面还没有这一行，
 * 所以依据是运行时截图而不是 bundle。
 */
export declare const HANDOFF_CONTEXT_HINT = "Your conversation moved to the background \u2014 enter opens it \u00B7 esc returns to it \u00B7 ctrl+c twice quits";
/** 空列表时输入框上方的引导文案 */
export declare const EMPTY_LIST_HINT = "Describe a task below and press enter to dispatch your first session";
/** 尚未收到首个 prompt 的行提示 */
export declare const AWAITING_FIRST_PROMPT_HINT = "space to send it a prompt";
/** 仅能在会话内运行的命令的提示 */
export declare const ATTACH_ONLY_COMMAND_HINT = "attach to a session to run it";
/** 删除被拒绝时的行内标记 */
export declare const NOT_DELETED_MARKER = "not deleted";
/**
 * 旧版 worker 写进 `state.detail` 的转后台样板句。
 *
 * 它对「这一行和别的行有什么不同」贡献为零——四行阻塞会话挂着同一句话，
 * 真正的问题反而藏在 peek 里。渲染层识别到它就换成有信息量的内容。
 */
export declare const NO_SIGNAL_DETAIL_PATTERN: RegExp;
/** 阻塞中但拿不到具体问题时的兜底摘要 */
export declare const BLOCKED_FALLBACK_DETAIL = "waiting for your reply \u2014 space to answer";
/** 已完成行的 `result: ` 前缀——✓ 图标与 Completed 标题已经说了这件事 */
export declare const RESULT_PREFIX_PATTERN: RegExp;
/**
 * 页脚快捷键提示，按「窄终端先丢队尾」排列。
 * key 用 hint 色、动作用暗色渲染，比一整句暗字扫得快。
 */
export declare const FOOTER_HINTS: ReadonlyArray<readonly [string, string]>;
/** 派发纯文本 prompt 的最小长度。对齐 bundle 908569 的 `ASS` */
export declare const MIN_DISPATCH_PROMPT_LENGTH = 4;
/** 过短时的提示。对齐 bundle 906455 */
export declare const TOO_SHORT_HINT = "Too short \u2014 describe the task";
/** 粘贴折叠字符阈值。对齐 bundle 906745 的 `xkt` */
export declare const PASTE_COLLAPSE_CHARS = 800;
/** 粘贴折叠行数阈值（严格大于） */
export declare const PASTE_COLLAPSE_LINES = 2;
/** Ctrl+X 两连击删除的窗口。对齐 bundle 904385 的 `Oc(..., 2000)` */
export declare const DELETE_ARM_WINDOW_MS = 2000;
/** Ctrl+C 两连击退出的窗口 */
export declare const EXIT_ARM_WINDOW_MS = 2000;
/** Ctrl+C 第一击后的确认提示（与快捷键浮层的 press twice 文案一致） */
export declare const EXIT_CONFIRM_HINT = "Press ctrl+c again to exit";
/** agent view 轮询 jobs 目录的间隔 */
export declare const AGENT_VIEW_POLL_INTERVAL_MS = 800;
/** 行摘要复用会话自身输出时的最小刷新间隔（不发起模型请求）。对齐 bundle 476048 的 `efd` */
export declare const DETAIL_REFRESH_MIN_INTERVAL_MS = 15000;
/** 折叠前必须至少能藏这么多行，否则不如直接显示。对齐 `I5f` */
export declare const DONE_FOLD_MIN_HIDDEN = 3;
/**
 * 头部 + 输入框 + 提示行等固定占用的行数。
 * 原值 8 对齐 Claude 的 `HSS`（3 行头部）；头部并为 2 行后随之减 1，
 * 否则 chrome 多算 1 行，Completed 组会提前一行进入折叠/紧凑模式。
 */
export declare const DONE_FOLD_CHROME_ROWS = 7;
/** 首选给页脚预留的行数。对齐 `fti` */
export declare const DONE_FOLD_FOOTER_ROWS = 4;
/** 空间不足时压缩到的页脚行数。对齐 `OSS` */
export declare const DONE_FOLD_FOOTER_ROWS_COMPACT = 2;
/** 落在 cap 边界这段时间内完成的行合并进同一批展示。对齐 `DSS` */
export declare const DONE_FOLD_MERGE_WINDOW_MS = 60000;
/** 行首选中标记列宽度（marker 之外的列宽由 computeColumnWidths 分配） */
export declare const AGENT_VIEW_MARKER_WIDTH = 2;
/** 年龄列最小宽度。对齐 bundle 901610 的 `kSS` */
export declare const AGE_COLUMN_MIN_WIDTH = 8;
/** 会话名列最大宽度（列宽随最长可见名自适应，钳在 min/max 之间） */
export declare const NAME_COLUMN_WIDTH = 24;
/** 会话名列最小宽度：短名（`hi`）不再撑出 20 格空白，摘要列拿回预算 */
export declare const NAME_COLUMN_MIN_WIDTH = 10;
/** 图标列宽度（图标 + 间隔） */
export declare const ICON_COLUMN_WIDTH = 3;
/** 摘要列在极窄终端下的最小宽度 */
export declare const DETAIL_COLUMN_MIN_WIDTH = 12;
/** agent view 打开期间的终端标题。对齐 bundle 901754 的 `k5f` */
export declare function formatAgentViewTitle(awaitingInput: number): string;
/** 通知类型，与 Notification hook 的 notification_type 对齐 */
export declare const NOTIFICATION_TYPE_NEEDS_INPUT = "agent_needs_input";
export declare const NOTIFICATION_TYPE_COMPLETED = "agent_completed";
/**
 * 在 agent view 内直接执行而不派发会话的命令。对齐 Claude v2.1.216
 * bundle 906315-906441（design.md D6）：**恰好这 6 个**，其余内置命令
 * 一律回 `attach to a session to run it`（attach-only）。
 * 不含 `/continue`——Claude 未把它列入 host。
 */
export declare const AGENT_VIEW_HOST_COMMANDS: readonly string[];
