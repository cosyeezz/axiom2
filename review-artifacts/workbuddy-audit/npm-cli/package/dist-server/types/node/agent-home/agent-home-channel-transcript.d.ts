/**
 * 频道 transcript（`channels/<id>.jsonl`）读写：一行一条，不进 JobStore；文件名 = channel.id。
 *
 * 从 directory.json 的模块里分出来：两个落盘物、两套纪律——directory.json 带锁原子写、
 * 读一次要清洗；transcript 是 append-only 的 jsonl，读方免锁（唤醒/回执路径还只能同步读）。
 * 本模块 → directory 只 import type。
 */
import type { AgentHomeChannelSystemEvent } from './agent-home-channel-system-event';
import type { AgentHomeChannelMessage } from './agent-home-directory';
/** 频道 transcript：一行一条，不进 JobStore。文件名 = channel.id，不是显示名。 */
export declare function agentHomeChannelTranscriptPath(homeDir: string, channelId: string): string;
export declare function parseAgentHomeChannelTranscript(raw: string): AgentHomeChannelMessage[];
/** 读 jsonl，不拿 directory 锁。GET /messages 和入站回执共用。 */
export declare function readAgentHomeChannelMessagesSync(homeDir: string, channelId: string): AgentHomeChannelMessage[];
/**
 * 往频道 jsonl 投一行系统事件（如轮次收场）。投影纪律同任务板事件行：
 * 写失败不回滚、留审计（transcript_write_failed），绝不拦住主流程。
 */
export declare function appendAgentHomeChannelSystemEvent(input: {
    homeDir: string;
    channelId: string;
    event: AgentHomeChannelSystemEvent;
    text: string;
    now: number;
}): Promise<void>;
