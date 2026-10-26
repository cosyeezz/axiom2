/** Agent Home 自治能力的配额与护栏：纯常量 + 纯校验，工具层与 HTTP 共用。 */
import type { AgentHomeDirectoryFile } from './agent-home-directory';
/** 同事总数上限（不含默认 Agent），对齐 grok 的 MAX_AGENTS_PER_USER。 */
export declare const MAX_AGENTS_PER_USER = 50;
/** 频道总数上限：每频道 1 transcript + 1 board + 1 侧栏项。 */
export declare const MAX_CHANNELS = 20;
/**
 * 成员数上限/下限的唯一来源（domain sanitize、HTTP controller、web-ui 共用一份。
 * 以前同一个数字在四五个文件里各写一遍，改一处就会漂）。
 */
/** 私信房（数据模型里的 group）成员 2–6。 */
export declare const GROUP_MIN_MEMBERS = 2;
export declare const GROUP_MAX_MEMBERS = 6;
/** 频道成员 2–6。 */
export declare const CHANNEL_MIN_MEMBERS = 2;
export declare const CHANNEL_MAX_MEMBERS = 6;
/** 单个频道任务板的任务上限。 */
export declare const MAX_TASKS_PER_CHANNEL = 50;
/**
 * 单行短字段（名字/标题/引擎/权限模式）长度上限。
 *
 * HTTP 入参截断（controller/groups）与 domain 落盘截断（建人/建频道）必须同数：
 * 以前 60 在 HTTP 的 NAME_MAX、COLLEAGUE_NAME_MAX、CHANNEL_NAME_MAX 各写一遍，
 * 改一处就漂（HTTP 先截一刀、domain 再截一刀，两边不一致时用户看到的名字会莫名其妙）。
 */
export declare const AGENT_HOME_NAME_MAX = 60;
/** 长文本（描述/发言正文/预览）长度上限，同样 HTTP 与 domain 共用一份。 */
export declare const AGENT_HOME_TEXT_MAX = 2000;
/** 任务标题长度上限（HTTP / domain / web-ui 输入框共用一份）。 */
export declare const TASK_SUBJECT_MAX = 200;
/** 单条任务最多几条引用。 */
export declare const TASK_REFS_MAX = 20;
/** 单条任务引用的值（路径 / 链接 / 提交号）长度上限。 */
export declare const TASK_REF_VALUE_MAX = 1024;
/** 单个频道附件体积上限（聊天场景常识值 20MB；服务端校验与 web-ui 选择器共用一份）。 */
export declare const CHANNEL_ATTACHMENT_MAX_BYTES: number;
/** 一条消息最多几个附件（服务端与 web-ui composer 共用一份）。 */
export declare const CHANNEL_ATTACHMENT_MAX_PER_MESSAGE = 4;
/** 唤醒预算：同一任务对同一个人的自动唤醒次数上限，超限标 stalled。 */
export declare const MAX_WAKE_PER_TASK_PER_AGENT = 5;
/**
 * 成员互叫护栏（见 agent-home-channel-wake-guard）：每频道每窗口最多这么多次**自动**唤醒，
 * 超出就抑制（消息与未读照留，只是不叫人）。用户发言 / @ 点名 / 派单不受限。
 * 可用 env 覆盖：`CODEBUDDY_AGENT_HOME_WAKE_WINDOW_MS` / `CODEBUDDY_AGENT_HOME_WAKE_MAX`。
 */
export declare const CHANNEL_AUTO_WAKE_WINDOW_MS: number;
export declare const CHANNEL_AUTO_WAKE_MAX = 3;
export declare function channelAutoWakeWindowMs(): number;
export declare function channelAutoWakeMax(): number;
/** 创建深度：默认 Agent 建的人 depth=0，其再建 +1；超过即拒。 */
export declare const MAX_CREATOR_DEPTH = 2;
/** escalate nudge 的默认「多久没动算卡住」阈值。 */
export declare const DEFAULT_NUDGE_STALE_MS: number;
/** create / dispatch 的 requestId 幂等窗口。 */
export declare const REQUEST_ID_WINDOW_MS: number;
/** 注入给成员的房间消息单条截断长度（轮次/条数上限见 channel-room-turn.ts）。 */
export declare const CHANNEL_TRANSCRIPT_MESSAGE_MAX = 2000;
/** 一次 dispatch 最多派几条（防止一次刷爆看板）。 */
export declare const MAX_DISPATCH_BATCH = 10;
export declare function countColleagues(directory: AgentHomeDirectoryFile): number;
export declare function countChannels(directory: AgentHomeDirectoryFile): number;
/** 建人前的配额判据：返回 true = 还能建。 */
export declare function canCreateColleague(directory: AgentHomeDirectoryFile): boolean;
/** 建频道前的配额判据：返回 true = 还能建。 */
export declare function canCreateChannel(directory: AgentHomeDirectoryFile): boolean;
/** 进程消失后跳过它的保护窗：交棒后 15s 内进程没在跑算"还在起"，不跳过。 */
export declare const ROOM_TURN_WATCHDOG_MIN_AGE_MS = 15000;
/** 一轮的绝对上限（到点直接收场，不叫任何人）：兜底一切卡死形态。 */
export declare const ROOM_TURN_MAX_AGE_MS: number;
/** 活着但迟迟不回：每 4 分钟催办一次。 */
export declare const ROOM_TURN_NUDGE_AFTER_MS: number;
/** 每人每棒最多催办 3 次；催满仍不回就按弃权推进队列。 */
export declare const ROOM_TURN_MAX_NUDGES = 3;
