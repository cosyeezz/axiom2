/**
 * 房间联系人解析。无 fs；吃 directory 形状。
 */
import type { AgentHomeDirectoryFile, AgentHomeProfile } from './agent-home-directory';
export interface RoomContact {
    id: string;
    name: string;
    /** 投递目标：对方的主对话。没有=还没开口，联系不上 */
    jobId?: string;
}
export interface RoomContactScope {
    groupId: string;
    groupName: string;
    contacts: RoomContact[];
}
/** `resolveMeAsAgent` 的身份解析策略：**可见性宽松、动作严格**（#125667 评审）。 */
export interface ResolveMeAsAgentOptions {
    /**
     * 动作路径传 `false`：**只有真的登记成同事的 job** 才 fail-closed。
     *
     * 判据是「这个 jobId 在 jobAssignments 里有归属」，不是「有 jobId」：jobId 是进程级
     * 身份，用户自己的会话（桌面 / Web UI 派发 / TUI 后台）同样带一个，只是不在表里——
     * 默认 Agent 按设计不登记，它的范围就是「表里没有的那些」（见 agent-home-session-scope）。
     * 把「有 jobId 但没归属」一律当成未认领的同事 job，会把用户自己的会话挡在
     * 发言 / 私信 / 改板之外（频道工具实测死锁：主 Agent 全部动作被拒）。
     *
     * 归属指向已被删除的同事时上面已返回 undefined（同样 fail-closed）；
     * 这里只剩「归属 = 默认 Agent」这种畸形数据，动作路径不认它。
     *
     * 无 jobId 的真实主会话与这个开关无关，永远回落默认 Agent（主 Agent 语义不变）。
     */
    fallbackToDefault?: boolean;
}
/**
 * 当前说话人。
 *
 * 顺序：jobId 映射 → 会话级登记（sessionAssignments）→ 默认 Agent（可关，见 options）。
 * 中间那步是为了兜住 jobId 缺失或尚未写入 jobAssignments 的同事会话（jobId 是进程级
 * 一次性信号，job 内派生会话拿不到）——没有它，同事解析不出身份，频道工具会整体消失。
 *
 * 最后那步是**两义**的：默认 Agent 是「用户」，所以它既是可见性兜底（工具在不在），
 * 也是身份冒用的入口（发言/私信/改板的归属）。`fallbackToDefault: false` 只拒绝
 * **登记过归属的 job**（见 ResolveMeAsAgentOptions）——未登记的 job 就是用户自己的会话。
 */
export declare function resolveMeAsAgent(directory: AgentHomeDirectoryFile, myJobId: string | undefined, mySessionId?: string, options?: ResolveMeAsAgentOptions): AgentHomeProfile | undefined;
/**
 * 只看我所在的可见房间。没有 job id = 默认 Agent，联系人永远为空。
 * `mySessionId` 必须和工具路径同源地传进来：会话已登记、进程又没有 jobId 的同事
 * （「新建智能体」续跑 / job 内派生会话）只有靠它才认得出自己，否则花名册会按默认
 * Agent（= 用户）算 —— 同一会话在工具路径与提醒路径给出两个身份（#125667 F6）。
 */
export declare function resolveRoomContacts(directory: AgentHomeDirectoryFile | undefined, myJobId: string | undefined, mySessionId: string): RoomContactScope[];
export declare function flattenRoomContacts(scopes: readonly RoomContactScope[]): RoomContact[];
