/**
 * 读盘自愈：directory.json 的清洗层。坏数据不卡住读盘，策略变更也不静默删用户的房间。
 *
 * 从 agent-home-directory 拆出：27 个消费者里绝大多数只要"类型 + 读一次"，
 * 不该被这 240 行防御逻辑（以及它依赖的 membership / limits）拖着走。
 * 依赖单向：本模块 → directory 只 import type；directory → 本模块是运行时调用。
 */
import { type AgentHomeChannel, type AgentHomeDirectoryFile, type AgentHomeGroup, type AgentHomeRemoteMember } from './agent-home-directory';
/**
 * 外部成员归一化（占位字段）：只留形状对的、按 authId 去重、上限 24（对齐上游）。
 * 现在没有任何判定依赖它，纯粹不让脏数据落进来。
 */
export declare function sanitizeExternalMembers(raw: unknown): AgentHomeRemoteMember[];
/** 读盘时丢掉空 id / 重复 id；transcriptId 收成 id；按加入资格（主 Agent/极简）剔成员。 */
export declare function sanitizeAgentHomeChannels(channels: AgentHomeChannel[], blocked?: string | ReadonlySet<string>, reservedIds?: ReadonlySet<string>, validAgentIds?: ReadonlySet<string>, 
/** 额外不许出现在 roomTurn 里的人（分身：可在成员表，不进轮次）。 */
turnOnlyBlocked?: string): AgentHomeChannel[];
/**
 * 读盘时剥掉早期「房间 = 一条 Run」的标记并去重成员。
 * 不足两人当场丢掉，不留 1 人房。不按引擎 / 默认 Agent 踢人。
 */
export declare function sanitizeAgentHomeGroups(groups: AgentHomeGroup[], blocked?: string | ReadonlySet<string>): AgentHomeGroup[];
export declare function groupsHaveLegacyRoomJob(groups: readonly AgentHomeGroup[]): boolean;
/**
 * 会话级登记的保留上限：jobId 缺失才用得到，防目录无限膨胀（#125667 F4）。
 * **保留最新**：登记是追加的，淘汰必须丢老留新（见下方清洗段）。
 * 淘汰口径是 **FIFO 而非 LRU**：同名 sessionId 重新登记不会挪到末尾
 * （agent-home-session-owner 命中同值时直接 return false，不写盘），所以"老而活跃"的
 * 会话在满员后仍可能被淘汰。接受这个代价（真 LRU 要 delete+set 重排 = 多写盘）；
 * 若线上出现"活跃会话被淘汰"的形态，再改成挪位。
 * export 给 spec：上限淘汰方向是会被改错的那种细节（改了没有类型报错）。
 */
export declare const AGENT_HOME_SESSION_ASSIGNMENTS_MAX = 2000;
export declare function sanitizeAgentHomeDirectory(directory: AgentHomeDirectoryFile): AgentHomeDirectoryFile;
