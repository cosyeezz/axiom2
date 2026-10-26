/**
 * 频道「房间轮次」编排 —— 对齐上游群聊模型（grok bot group chat）。
 *
 * 上游规则（数值与语义都照搬，不要按手感改）：
 * - 一次 room turn 最多 3 轮，跨轮累计最多 10 条成员发言；
 * - 每轮按名册顺序发言，且**每轮换首发**（offset = round % 人数）；
 * - 每个成员每轮最多跑一次；每人每轮最多计 2 条消息（超出不计、按弃权推进）；
 * - @ 点名时只回被点名的人；@everyone/@all 或没有任何 @ 时全员参与；
 * - 成员只看到「自他上次发言以来」的新消息，最多 24 条；
 * - 没话可说回 "(pass)"：不计条数、不落盘，但推进轮转。
 *
 * 上游为什么这么做（我们照抄的是结论，注释记的是道理）：
 * - **有界**：3 轮 × 10 条是硬上限。群聊最坏情况是 agent 互相客套到天亮，
 *   上限把成本钉死，也让"这轮说完了"有明确终点。
 * - **公平**：每轮换首发。否则永远同一个人定调，别人就退化成回声，
 *   群聊会变成"一个人发言 + N 个附议"。
 * - **点名优先**：用户 @ 谁就是只想听谁说；没 @ 才放开全员。
 * - **只给增量**：成员看「自他上次发言以来」的消息。给全量历史的话，
 *   每轮 prompt 都会线性膨胀，且模型容易复述已经说过的内容。
 * - **允许 (pass)**：没新信息时明说 pass，而不是为发言而发言。
 *   没有这个出口，模型会用"同意/收到"这类空话把条数配额烧完。
 * - **防刷屏**：单成员一次最多 2 条，避免一个人把房间刷满。
 *
 * 与上游的映射差异（我们是独立 job + 消息驱动，上游是单进程 await 编排）：
 * - 上游：编排器依次 await 每个成员的 turn，一个 turn 内最多收 2 条消息；
 * - 我们：一次唤醒 = 一个成员 turn，成员的发言（含 pass）是编排的推进事件。
 *   所以轮次由"有人发言"驱动，而不是由编排器循环驱动。
 */
import type { AgentHomeChannelMessage, AgentHomeChannelRoomTurn } from './agent-home-directory';
/** 一次 room turn 最多几轮（上游 GROUP_MAX_ROUNDS）。 */
export declare const ROOM_MAX_ROUNDS = 3;
/** 一次 room turn 跨轮累计最多几条成员发言（上游 GROUP_MAX_MEMBER_TURNS）。 */
export declare const ROOM_MAX_MESSAGES = 10;
/** 一个成员一次 turn 最多计几条消息，超出丢弃（上游 GROUP_MAX_MESSAGES_PER_TURN）。 */
export declare const ROOM_MAX_MESSAGES_PER_TURN = 2;
/** 注入给成员的"自上次发言以来"的消息条数上限（上游 GROUP_PROMPT_HISTORY_LIMIT）。 */
export declare const ROOM_PROMPT_HISTORY_LIMIT = 24;
/**
 * 每轮换首发：offset = round % 人数。
 * 上游 orderRoundSpeakers 的等价实现；成员集合为空时返回空。
 */
export declare function orderRoundSpeakers<T>(memberIds: readonly T[], round: number): T[];
/** 空内容或 "(pass)"/"pass." 都算弃权（上游 isPassContent）。 */
export declare function isPassContent(content: string): boolean;
/**
 * 谁该回应：从最后一条用户发言起（含）扫描 @。
 * - @everyone / @all → 全员；
 * - 一条 @ 都没有 → 全员（群聊语义：没点名就大家都有机会）；
 * - 有 @ → 只回被点名的人（用户点名是有意为之）。
 */
export declare function resolveRoomResponders(input: {
    memberIds: readonly string[];
    messages: readonly AgentHomeChannelMessage[];
}): string[];
/**
 * 成员本轮能看到的内容：自他上次发言以来的消息，最多 ROOM_PROMPT_HISTORY_LIMIT 条。
 * 上游 messagesSinceMemberLastSpoke + formatGroupHistory 的组合语义。
 */
export declare function messagesSinceMemberLastSpoke(messages: readonly AgentHomeChannelMessage[], memberId: string): readonly AgentHomeChannelMessage[];
/** 开一次 room turn：解析该回应的人，按第 0 轮顺序排好，叫第一位。 */
export declare function startRoomTurn(input: {
    memberAgentIds: readonly string[];
    messages: readonly AgentHomeChannelMessage[];
    now: number;
    /**
     * 刚开口的那个人（成员 kickoff 时是发言的同事）。
     *
     * 上游把发言人也算进 responders，因为他那边是**同步 await 编排**：
     * 轮到发言人自己时，他看到的 "自上次发言以来" 是空的，会立刻 (pass)——
     * 代价只是一次空转。我们是消息驱动：叫醒靠投递收件箱，而投递会把
     * 说话人自己排掉（不给自己发自己的入站）。所以要是首发恰好是他自己，
     * 这一棒就没人接——整轮静静地停在那里等看门狗。
     * 结论：开轮时直接不排说话人，效果和上游"他 pass 掉"一致，但没有那一棒空转。
     */
    excludeAgentId?: string;
}): {
    turn: AgentHomeChannelRoomTurn;
    firstSpeakerId: string;
} | undefined;
export interface AdvanceRoomTurnResult {
    /** 下一个该被叫的人；undefined = 本次 room turn 结束。 */
    nextSpeakerId?: string;
    /** 更新后的状态；undefined = 已结束（调用方清掉频道上的 roomTurn）。 */
    turn?: AgentHomeChannelRoomTurn;
}
/**
 * 成员发言后推进编排。返回下一位该发言的人，或结束。
 *
 * 顺序：先记条数（pass 不计），再沿本轮 order 找下一位；本轮跑完就进下一轮
 * （换首发）；三重终止条件取先到者：
 * 1) 累计条数到 ROOM_MAX_MESSAGES（成本上限）；
 * 2) 轮数到 ROOM_MAX_ROUNDS；
 * 3) 整整一轮没人发言（= 没有增量信息，继续只是空转）。
 */
export declare function advanceRoomTurn(input: {
    turn: AgentHomeChannelRoomTurn;
    speakerId: string;
    pass: boolean;
    /** 指针移动的时间戳（看门狗按它算"刚交棒"保护）。 */
    now?: number;
}): AdvanceRoomTurnResult;
