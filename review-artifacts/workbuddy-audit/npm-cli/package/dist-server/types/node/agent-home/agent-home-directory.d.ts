/**
 * 落盘：`~/.codebuddy/agent-home/directory.json`。
 * 写必须进 `withAgentHomeDirectoryLock`。
 * Channel ≠ Room ≠ 1:1。组队禁令只在 UI 拦，读盘不按引擎 / 默认踢人。
 *
 * ⚠️ 本模块（连同 agent-home-limits / membership / mentions / envelope-body）会被 web-ui
 * 直接 import。**别在这里引 node 侧的重模块**（../cli、../session、../tools，以及会牵出
 * 它们的 agent-home-errors / agent-home-channel-tasks…）：type-only 也会把整个 node 端
 * 拉进前端 typecheck，前端构建会炸出几千条无关的装饰器错误。
 */
import type { ChannelAttachment } from './agent-home-attachments';
import type { AgentHomeChannelSystemEvent } from './agent-home-channel-system-event';
import type { AgentHomeChannelTaskEventPayload } from './agent-home-channel-task-event';
import type { AgentHomeChannelWidget } from './agent-home-channel-widget';
import { type ResolveMeAsAgentOptions } from './agent-home-room-contacts';
import type { AgentHomeSystemPrompt } from './agent-home-system-prompt';
export { CHANNEL_MAX_MEMBERS, GROUP_MIN_MEMBERS } from './agent-home-limits';
export { agentHomeTeamJoinBlock, blockedTeamAgentIds, canJoinAgentHomeChannel, canJoinAgentHomeRoom, canJoinAgentHomeTeam, type AgentHomeTeamJoinBlock, type RoomMessageCallStyle, roomMessageCallStyle, teamBlockedDefaultId, twinJoinsTeams, } from './agent-home-membership';
export { flattenRoomContacts, resolveRoomContacts, type ResolveMeAsAgentOptions, type RoomContact, type RoomContactScope, } from './agent-home-room-contacts';
export interface AgentHomeProfile {
    id: string;
    name: string;
    /**
     * 'auto' = name 只是新建时的占位名（用户没起名），主对话第一次生成 AI 标题时
     * 由 applyAgentHomeAutoName 换成标题并清掉本字段。缺省 = 用户起的名字，永不自动覆盖。
     */
    nameSource?: 'auto';
    /** 头像变体；0 专供默认 Agent（分身），普通同事使用 1..AGENT_HOME_AVATAR_VARIANT_COUNT-1。 */
    avatarVariant?: number;
    /** 一行职务（侧栏次行可用） */
    title?: string;
    /** 人设 / 系统提示补充 */
    description?: string;
    /** 引擎：cli | ptc | minimal | create | 自定义 agent 名；缺省=产品默认 */
    engine?: string;
    /**
     * 这个同事固定跑哪个模型 / 权限模式（建人时定，启 job 时拼进 --model / --permission-mode）。
     * 缺省 = 跟随产品默认（和用户新开一个 Run 的默认一致）。
     */
    model?: string;
    permissionMode?: string;
    /**
     * 这个智能体的系统提示词（Web UI 里的 `--system-prompt` / `--append-system-prompt`）。
     * 每轮按会话归属解析后生效，改了下一轮就用新的；缺省 = 产品默认提示词。
     */
    systemPrompt?: AgentHomeSystemPrompt;
    /** 家目录：新 Run 的默认 cwd */
    homeCwd: string;
    /**
     * 这个人的主对话（第一句 createJob 的那条）。缺省=还没说过话。
     * 点行只打开这一条，不抢桶里最新 Run。
     */
    primaryJobId?: string;
    visibility: 'visible' | 'hidden';
    /** 侧栏分组。缺省 = 未分组。私信房簇不进分组。 */
    sectionId?: string;
    createdAt: number;
    lastActiveAt?: number;
    /** 被频道 @ 了：侧栏人行黄点。点开人或点开频道再清。 */
    unreadByUser?: number;
    /** 谁建的（自治组的队）。缺省 = user（含历史数据）。 */
    createdBy?: 'user' | 'agent';
    /** 建人者 agentId（createdBy=agent 时）。 */
    createdByAgentId?: string;
    /** 自治创建的深度：默认 Agent 建的人=0，其再建 +1；上限见 agent-home-limits。 */
    depth?: number;
    /**
     * 仅默认 Agent（分身）有：能否加入房间/频道（见 agent-home-membership 的「分身入群」）。
     * 缺省按开处理；读盘清洗会给默认 Agent 补成显式布尔，顺带完成一次旧名迁移。
     */
    joinTeams?: boolean;
}
/** 分身的出厂名。旧目录里出厂名是 'CodeBuddy'，读盘时一次性迁过来。 */
export declare const AGENT_HOME_TWIN_DEFAULT_NAME = "\u6211\u7684\u5206\u8EAB";
export declare const AGENT_HOME_LEGACY_DEFAULT_NAME = "CodeBuddy";
/**
 * 房间：把已有同事编成一组。只是分组 / ACL，不是第三个说话的人，
 * 也不是 Agent Teams（那套是 `name@team` + `~/.codebuddy/teams/`）。
 * 成员各自的对话和 homeCwd 不变。
 */
export interface AgentHomeGroup {
    id: string;
    name: string;
    /** 2–6 人，去重；顺序 = 叠头像 / 成员条顺序。全目录只能有一间房。 */
    memberAgentIds: string[];
    /** 建房时定，加人/移出都不改（免得 Files 乱跳） */
    homeCwd: string;
    visibility: 'visible' | 'hidden';
    pinned?: boolean;
    /** 未置顶时的顺序，默认 createdAt */
    sortIndex: number;
    createdAt: number;
    lastActiveAt?: number;
    unreadByUser?: number;
    lastPreview?: string;
    /** 组队中（Agent Teams 的队名）：禁止改成员 / 解散 */
    activeTeamName?: string;
}
/**
 * 频道：通讯录里和人对等的一条群对话。
 * 不是私信房（groups）：房间没有自己的会话；频道有自己的 transcript。
 * 主键是 `id`（UUID），可以多间；禁止把 channel.id 写进 jobAssignments。
 * `transcriptId` 必须等于 `id`，jsonl 路径 `channels/<id>.jsonl`。
 */
export interface AgentHomeChannel {
    id: string;
    name: string;
    /** 2–6 人，都在 agents[]。用户发言可全员叫醒；成员发言只叫 @。默认 Agent 不叫。 */
    memberAgentIds: string[];
    /** 频道自己的会话 id，不是 jobId */
    transcriptId: string;
    /** 有人提文件时才用；默认第一个成员的家。不改成员档案。 */
    homeCwd: string;
    visibility: 'visible' | 'hidden';
    pinned?: boolean;
    sectionId?: string;
    sortIndex: number;
    unreadByUser?: number;
    lastPreview?: string;
    lastActiveAt?: number;
    createdAt: number;
    /**
     * 频道 lead：看板快照只推给 lead，dispatch / escalate 也只有 lead 能调。
     * 缺省 = user-as-lead（用户自己编排）。被移出成员时 sanitize 会清掉，自动降级。
     */
    leadAgentId?: string;
    /** 谁建的频道。缺省 = user（含历史数据）。 */
    createdBy?: 'user' | 'agent';
    createdByAgentId?: string;
    /**
     * 进行中的房间轮次（对齐上游群聊：一次 room turn 最多 3 轮 / 10 条发言）。
     * 不存在 = 当前没有轮次；由 channel-room-turn.ts 的状态机推进。
     */
    roomTurn?: AgentHomeChannelRoomTurn;
    /**
     * 跨人共享房间的 id（占位，对齐上游 SandGroupConfig.sharedRoomId）：
     * 本机频道将来挂到共享房间上时填这里，现在不参与判定。
     */
    sharedRoomId?: string;
    /** 共享房间的主机（占位，对齐上游 SandRemoteRoomConfig.hostAuthId/hostName）。 */
    host?: {
        authId: string;
        name: string;
    };
}
/** 房间轮次状态；字段语义见 agent-home-channel-room-turn.ts。 */
export interface AgentHomeChannelRoomTurn {
    startedAt: number;
    round: number;
    messages: number;
    responderIds: string[];
    order: string[];
    cursor: number;
    /** 当前这一棒是什么时候交出去的（看门狗按它算"刚叫醒"保护，而不是按轮起点）。 */
    cursorSetAt?: number;
    spokenThisRound: number;
    /** 每人本轮已计条数（上限 ROOM_MAX_MESSAGES_PER_TURN）。 */
    spokenByAgent?: Record<string, number>;
    /**
     * 这一棒已经催过几次（对齐上游 ack 语义：收到消息不回应算欠一条回信）。
     * 到上限就不再催，避免无限烧钱。
     */
    nudges?: number;
    /**
     * 上一次催办的时间。与 cursorSetAt（交棒时刻）分开：催办要按"上次催了多久"
     * 算间隔，交棒时刻还要给"进程死了多少秒才跳过"的保护窗用——催办刷新交棒时刻
     * 会把死人的保护窗一起拉长（实测会让看门狗误判）。
     */
    lastNudgeAt?: number;
}
/** 频道 jsonl 一行。不进 JobStore，也不进对方 1:1。 */
export interface AgentHomeChannelMessage {
    id: string;
    at: number;
    from: 'user' | 'agent' | 'system';
    agentId?: string;
    text: string;
    mentionAgentIds?: string[];
    /**
     * 任务板事件行（kind='task'）：text 是给人看的一行事件描述，
     * taskPayload 是结构化本体（UI 按当前语言渲染）；taskEvent/taskId 只是
     * 透传给前端的事件类型/任务 id 冗余字段（渲染只用 taskPayload）。
     */
    kind?: 'task' | 'widget' | 'system';
    /**
     * 系统事件行（kind='system'）：text 是给人看的一行兜底描述，
     * systemEvent 是结构化本体（UI 按当前语言渲染）。
     */
    systemEvent?: AgentHomeChannelSystemEvent;
    taskEvent?: string;
    taskId?: string;
    /**
     * 结构化事件本体。UI 用它**按当前语言**渲染这一行（text 只是当时写下的那份，
     * 英文界面不该看到中文系统行）；缺它（老记录）时回落 text。
     */
    taskPayload?: AgentHomeChannelTaskEventPayload;
    /**
     * 弃权标记（"(pass)"）。对齐上游：pass 不写进 transcript、不计入轮次条数，
     * 只用于推进轮转 —— 所以它只存在于内存里的这条消息上，不落盘。
     */
    pass?: boolean;
    /**
     * 选项卡卡片（对齐上游 SendMessage 的 type:widget）：
     * 用户点选后以普通用户发言回到房间（带 replyTo 指向本条），
     * 因此"是否已答/答了什么"直接从消息流推导，不改写历史。
     */
    widget?: AgentHomeChannelWidget;
    /**
     * 附件（对齐上游 SendMessage 的 type:attachment）：
     * 落盘时已复制进频道附件目录，file 是内容寻址的存储名。
     */
    attachments?: ChannelAttachment[];
    /**
     * 引用的消息 id（对齐上游 SendMessage 的 reply_to）。
     * 房间历史里的每条消息都带一个短地址（#xxxxxxxx），成员用地址引用；
     * 落盘存解析后的完整 id，UI 据此在气泡上方画一条引用。
     */
    replyTo?: string;
}
/** 侧栏分段。缺省 = 未分组。私信房簇不进分组。 */
/**
 * 外部成员（占位，对齐上游 RemoteRoomMember）：将来跨人/跨机协作时，
 * 房间里可能出现"别人的 agent"或"另一个人"。现在**只留字段位**，
 * 读盘原样透传，不参与任何权限/唤醒判定。
 */
export interface AgentHomeRemoteMember {
    kind: 'agent' | 'human';
    /** 对方的稳定身份（上游 authId）：同一个人的多个 agent 共享它。 */
    authId: string;
    /** kind=agent 时是对方的 agentId；human 时空。 */
    agentId?: string;
    displayName: string;
    avatarUrl?: string;
}
export interface AgentHomeSection {
    id: string;
    name: string;
    sortIndex: number;
}
export interface AgentHomeDirectoryFile {
    version: 1;
    defaultAgentId: string;
    agents: AgentHomeProfile[];
    /** jobId → 同事 agentId。没有映射的 job 未认领；默认 Agent 不进 jobs/。 */
    jobAssignments: Record<string, string>;
    /**
     * sessionId → 同事 agentId：会话级身份登记。
     *
     * jobId 是进程级一次性信号（`claimJobIdentity` 读完即从 env 摘除），job 内派生的会话、
     * 以及「新建智能体」首轮尚未写入 jobAssignments 的窗口里都拿不到它 —— 那时同事解析不出
     * 自己是谁，频道工具会整体消失。本表是持久归属，按会话 id 兜住这些形态。
     * 旧文件没有该字段，读成 {}，version 不升。
     */
    sessionAssignments?: Record<string, string>;
    /** 房间。旧文件没有这个字段，读成 []，version 不升。 */
    groups: AgentHomeGroup[];
    /** 频道。旧文件没有这个字段，读成 []，version 不升。 */
    channels?: AgentHomeChannel[];
    /** 侧栏分组。旧文件没有这个字段，读成 []。 */
    sections?: AgentHomeSection[];
    /**
     * 外部成员（占位，对齐上游 remote-room.json 的 members）：跨人协作的未来入口。
     * 读盘清洗只做格式校验；不参与成员资格 / 唤醒 / 权限。
     */
    externalMembers?: AgentHomeRemoteMember[];
}
export declare function agentHomeDirectoryPath(homeDir: string): string;
export { mentionAgentIdsFromText } from './agent-home-mentions';
export declare function bumpUnread(target: {
    unreadByUser?: number;
}): void;
/**
 * 把默认 Agent 的家目录投影为宿主进程的当前启动目录（`--serve` cwd）。
 *
 * 档案只在首次 bootstrap 时记过一次 homeCwd，之后换目录启动不会更新 —— 主对话的
 * 工作区（顶栏副标题 / 输入框目录 chip / 空状态 / 侧栏 chip）会一直显示历史目录。
 * **只投影读快照、不落盘**：同一个 HOME 可能并存多个宿主（TUI + 多个 serve），落盘
 * 会让默认 Agent 的家目录在它们之间来回改写。job 进程别传 hostCwd（同事 Run 的 cwd
 * 是同事家目录）。值没变时保留原对象引用 —— 目录 15s 轮询一次，引用一换 memo 链就断。
 */
export declare function projectDefaultAgentHostCwd<T extends {
    id: string;
    homeCwd: string;
}>(agents: T[], defaultAgentId: string | null | undefined, hostCwd: string | undefined): T[];
/** 原子写 directory.json。调用方必须已经持有 withAgentHomeDirectoryLock。 */
export declare function writeAgentHomeDirectoryFile(homeDir: string, directory: AgentHomeDirectoryFile): Promise<void>;
/**
 * 只读加载。文件不存在 / 损坏 / 版本对不上都返回 undefined——
 * 读方一律降级成「没有房间」，绝不代替控制器 bootstrap 或写盘。
 */
export declare function readAgentHomeDirectory(homeDir: string): Promise<AgentHomeDirectoryFile | undefined>;
/**
 * 同步版：给必须同步作答的调用点用（工具的 isEnabled）。
 * 目录是几 KB 的本地 JSON，且写方用的是原子 rename，读到的永远是完整文件。
 */
export declare function readAgentHomeDirectorySync(homeDir: string): AgentHomeDirectoryFile | undefined;
/**
 * 叫醒落点：只认仍归这个人的 primaryJobId。
 * primary 被改派走：如果只剩一条 assignment 就用那条；多条不猜 Object.entries 顺序。
 * 未映射的 primary 归默认 Agent 名下，不能当这个人的投递点。
 */
export declare function resolveMemberJobId(directory: AgentHomeDirectoryFile, agentId: string): string | undefined;
export declare function ownedJobIds(directory: AgentHomeDirectoryFile, agentId: string): string[];
/**
 * 幽灵 job 对账用的清理：把这条 job 的映射整个忘掉（认领关系 + 任何指向它的 primary）。
 * 返回有没有真的改到。纯函数，调用方负责在目录锁内落盘。
 *
 * 为什么需要：用户删掉某个 Run 之后，directory 里的 primaryJobId/jobAssignments 仍指向它；
 * 于是「招人」判定命中 existing 不再重建，投递只会把信写进一个复活出来的空壳目录。成员就此永久哑掉。
 */
export declare function forgetJobId(directory: AgentHomeDirectoryFile, jobId: string): boolean;
/** 我能说话的可见频道。不是房间 ACL。
 * 主 Agent 不在成员表里（它是委托侧的工作现场），但说出来的话就是用户的话，
 * 所以它对每个可见频道都能发言；同事仍然只认自己名下的频道。
 */
export declare function channelsForSelf(directory: AgentHomeDirectoryFile | undefined, jobId?: string, sessionId?: string): AgentHomeChannel[];
/**
 * 当前说话人。没有 job id = 主会话默认 Agent（用户 1:1，不是同事）。
 * job worker 必须对上 primaryJobId / jobAssignments；认不出时看 options（见
 * ResolveMeAsAgentOptions）：可见性路径回落默认 Agent，动作路径传
 * `{ fallbackToDefault: false }` 拿 undefined 并据此拒绝。
 */
export declare function resolveAgentHomeSelf(directory: AgentHomeDirectoryFile | undefined, jobId?: string, sessionId?: string, options?: ResolveMeAsAgentOptions): AgentHomeProfile | undefined;
