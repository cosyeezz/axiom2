/**
 * 房间轮次看门狗：当前发言人的**进程没了**就跳过它，别让整轮静默停摆。
 *
 * 判据为什么是「进程死没死」而不是超时：
 * 实测一次成员 turn 正常要 3–4.5 分钟（它真的在干活），任何小超时都会误伤；
 * 而进程消失是确定性的"这一棒断了"，可以立刻接上。另配一个宽松的绝对上限
 * （ROOM_TURN_MAX_AGE_MS）兜住"进程还在但永远不发言"的病态情况。
 *
 * 这一层只做决策（纯函数，好测）；读写目录与叫人都由调用方（wake broker）做。
 */
import type { AgentHomeChannel } from './agent-home-directory';
/** 刚叫醒的 15s 内不判死：进程可能正在起（实测注入约 2.5s）。 */
export interface RoomTurnSweepDecision {
    /** hold = 不动；skip = 跳过当前发言人；end = 收场；nudge = 还活着但太久没回，再催一次。 */
    kind: 'hold' | 'skip' | 'end' | 'nudge';
    /** skip 时：更新后的轮次状态与新发言人。 */
    turn?: AgentHomeChannel['roomTurn'];
    nextSpeakerId?: string;
    reason?: 'speaker-gone' | 'too-long' | 'speaker-silent';
}
/**
 * 对单个频道做一次判定。
 *
 * @param speakerAlive 当前发言人是否还活着。默认 Agent（主会话）没有 job，
 *                     调用方应直接返回 true（判不了就当活着，别误伤）。
 */
export declare function decideRoomTurnSweep(input: {
    channel: AgentHomeChannel;
    speakerAlive: boolean;
    now: number;
}): RoomTurnSweepDecision;
/** 催办正文：还活着但太久没回，再点它一次（对齐上游"收到必须回"）。 */
export declare function roomTurnNudgeWakeText(name: string): string;
/** 看门狗叫下一位时用的正文（真正的上下文由房间历史给出）。 */
export declare function roomTurnWatchdogWakeText(nextSpeakerName: string): string;
