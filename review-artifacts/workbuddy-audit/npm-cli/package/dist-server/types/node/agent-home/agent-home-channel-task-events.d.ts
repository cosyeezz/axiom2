/**
 * 频道任务板的组合层：锁 → 读板 → 纯函数 mutate → 写板 → transcript 投影 → 算唤醒目标。
 *
 * 纪律：
 * - 板写必须在 withAgentHomeDirectoryLock 内；
 * - transcript 是投影不是真理：事件行写失败不回滚板；
 * - 唤醒永远在锁外（本模块只返回 wakeAgentIds / wakeText，调用方解锁后再叫）。
 */
import { type AgentHomeChannelTask, type AgentHomeChannelTaskActor, type AgentHomeChannelTaskBoard, type ChannelTaskAction, type ChannelTaskEvent } from './agent-home-channel-tasks';
import { type AgentHomeChannel, type AgentHomeDirectoryFile } from './agent-home-directory';
import type { ChannelTaskErrorCode } from './agent-home-errors';
import type { AgentHomeTaskReceiptMode } from './agent-home-settings';
export interface ApplyChannelTaskInput {
    homeDir: string;
    channelId: string;
    actor: AgentHomeChannelTaskActor;
    action: ChannelTaskAction;
    /** 自动投递到主 Agent 的回执级别；工具入口由用户设置解析。 */
    taskReceiptMode?: AgentHomeTaskReceiptMode;
    now?: number;
}
export type ApplyChannelTaskResult = {
    ok: true;
    tasks: AgentHomeChannelTask[];
    events: ChannelTaskEvent[];
    /** 板已扣预算的唤醒目标（解锁后由调用方叫）。 */
    wakeAgentIds: string[];
    /** 给被叫醒的人看的一行摘要。 */
    wakeText: string;
    directory: AgentHomeDirectoryFile;
    channel: AgentHomeChannel;
} | {
    ok: false;
    error: ChannelTaskErrorCode;
};
/** 免锁读板 + 频道（GET / SSE 语义）。 */
export declare function readChannelTaskBoard(input: {
    homeDir: string;
    channelId: string;
}): Promise<{
    ok: true;
    board: AgentHomeChannelTaskBoard;
    channel: AgentHomeChannel;
} | {
    ok: false;
    error: ChannelTaskErrorCode;
}>;
export declare function applyChannelTaskEvent(input: ApplyChannelTaskInput): Promise<ApplyChannelTaskResult>;
