/**
 * 频道寻址：id 分配 / 查找 / 默认命名。
 *
 * 从 agent-home-directory 拆出。规则对齐上游（group 只按 id 找，`ListGroups` 给的就是 id）：
 * **找频道只认 id**；名字只是给人看的标签（重名允许，默认名顺手避开「群聊」纯粹为了侧栏好认）。
 * 本模块 → directory 只 import type。
 */
import type { AgentHomeChannel, AgentHomeDirectoryFile } from './agent-home-directory';
/** 人 / 房 / 频道共用的 id 集合，分配频道 id 时避开，避免串台。 */
export declare function takenHomeIds(directory: AgentHomeDirectoryFile): Set<string>;
/** 新频道的主键。UUID，且不与已有人/房/频道 id 碰撞。 */
export declare function allocateUniqueChannelId(directory: AgentHomeDirectoryFile): string;
export type ChannelLookup = {
    status: 'ok';
    channel: AgentHomeChannel;
} | {
    status: 'missing';
} | {
    status: 'need-id';
};
/**
 * 频道查找：只认 id（对齐上游：group 按 id 寻址）。
 * 没传 needle 且只有一间 → 那一间；多间 → need-id（让调用方去 ListColleagues 抄 id）。
 */
export declare function lookupChannel(channels: readonly AgentHomeChannel[], wanted?: string): ChannelLookup;
export declare function formatChannelChoice(channels: readonly AgentHomeChannel[]): string;
/** 没起名时的标签。不是主键；重名允许，新建默认避开已有「群聊」纯粹为了列表好认。 */
export declare function nextDefaultChannelName(existing: readonly {
    name: string;
}[]): string;
