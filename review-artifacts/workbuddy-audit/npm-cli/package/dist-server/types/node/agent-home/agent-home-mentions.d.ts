/**
 * 频道 @：**正文里的名字**就是地址（对齐上游 `parseGroupMentions`）。
 * 撞名不判、不猜——同名的人**全部**被点到（上游就是逐个成员匹配后全收）。要精确到人
 * 就用 id：完整 id 或前 8 位（`@59c89708`）；`@所有人` / `@everyone` / `@all` 点全部成员。
 *
 * 工具参数不走这里：那是 id（见 agent-home-recipients 的说明）。
 */
export interface ChannelMentionMember {
    id: string;
    name: string;
}
export type ChannelTextPart = {
    kind: 'text';
    text: string;
}
/**
 * `linkAgentId` 只给芯片链接用（首个匹配，**不是**权威地址）；
 * 这次 @ 真正叫到的所有人是 `agentIds`（撞名时可能多个，唤醒一律用它）。
 */
 | {
    kind: 'mention';
    linkAgentId: string;
    agentIds: readonly string[];
    name: string;
} | {
    kind: 'everyone';
    name: string;
};
export declare const CHANNEL_EVERYONE_ALIASES: readonly ["所有人", "everyone", "all"];
/** @ 前的词边界（web-ui 补全与 node 切词共用一份，别各写一份漂移）。 */
export declare const CHANNEL_MENTION_BOUND: RegExp;
export declare function isEveryoneMentionName(name: string): boolean;
export declare function mentionAgentIdsFromText(text: string, members: readonly ChannelMentionMember[]): string[];
/** 工具 mentions[]：先 id（完整/前 8 位），再名字句柄（全名 / 去空格 / 第一个词），命中全部。 */
export declare function resolveChannelMentionIds(needles: readonly string[], members: readonly ChannelMentionMember[]): string[];
export declare function collectMentionAgentIds(text: string, members: readonly ChannelMentionMember[], options?: {
    everyone?: boolean;
}): string[];
export declare function splitChannelText(text: string, members: readonly ChannelMentionMember[]): ChannelTextPart[];
