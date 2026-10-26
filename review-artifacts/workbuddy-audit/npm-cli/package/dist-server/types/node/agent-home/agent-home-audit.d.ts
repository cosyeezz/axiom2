/**
 * 审计落点：建人/建频道/任务转换/唤醒投递都往 `agent-home/audit.jsonl` 追一行。
 * 审计失败不影响主流程；1MB 轮转 .old（读回要连 .old 一起读，见 readAgentHomeAudit）。
 */
export type AgentHomeAuditType = 'colleague_created' | 'channel_created'
/** 同一批人的频道已存在，复用了它。 */
 | 'channel_reused' | 'channel_member_added' | 'wake_delivered'
/** 同一棒太久没回，又催了一次（对齐上游 ack 重投）。 */
 | 'wake_nudged' | 'wake_skipped'
/** 信已持久化，但目标进程尚未拉起；与真正 skipped 分开。 */
 | 'wake_deferred'
/** job inbox 有待处理消息，但会话尚不满足消费条件。 */
 | 'job_inbox_waiting'
/** job inbox 已认领一批消息，准备交给会话运行时。 */
 | 'job_inbox_processing'
/** job inbox 批次已由会话运行时接收并确认。 */
 | 'job_inbox_acked'
/** job inbox 投递或确认失败，消息保留等待重试。 */
 | 'job_inbox_retrying'
/** 自动链被互叫护栏挡下（同轮去重 / 窗口限速）：消息照留，只是不叫人。 */
 | 'wake_throttled'
/** 任务完成 / 批次完成直接回报主 Agent：写了一封进主邮箱。 */
 | 'main_mail_enqueued'
/** 目录（预览/未读）写失败：jsonl 已落，但侧栏可能落后，留痕便于排查。 */
 | 'directory_write_failed'
/** 任务板写失败：什么都没改（写在投影之前），换领域错误码 BOARD_WRITE_FAILED 返回。 */
 | 'board_write_failed'
/** 事件行投影写失败：板已更新、时间线少这一行，不留痕就无从排查。 */
 | 'transcript_write_failed'
/** 主 Agent 邮箱里有认不出来的信：已隔离（不删），留痕说明为什么没投。 */
 | 'main_mail_quarantined'
/** 投给主会话成功（信已进历史 + 跑起一轮）：留痕带信龄与目标会话，排查"投给谁"用。 */
 | 'main_mail_delivered'
/**
 * 暂时不投（信留在盘上，不删不丢）：全新会话没开口 / 该投给别的活跃会话 / 旧信等用户在。
 * fields.reason = hold-targeted-session | hold-no-user-turn | hold-other-session | hold-stale。
 */
 | 'main_mail_held'
/** 旧格式（无 message_id）的信已在历史里：只跳过不删（判等会回落到正文，删了可能永久丢信）。 */
 | 'main_mail_skipped_legacy';
export interface AgentHomeAuditEvent {
    type: AgentHomeAuditType;
    at: number;
    /** 发起者 agentId；用户操作 = 'user'。 */
    actorAgentId?: string;
    channelId?: string;
    taskId?: string;
    /** 事件主体（被建的人 / 被唤醒的人）。 */
    targetAgentId?: string;
    fields?: Record<string, unknown>;
}
export declare function agentHomeAuditPath(homeDir: string): string;
export declare function appendAgentHomeAudit(homeDir: string, event: Omit<AgentHomeAuditEvent, 'at'> & {
    at?: number;
}): Promise<void>;
/**
 * 免锁读审计（配额判据 / 排查）。坏行跳过。
 *
 * 轮转后事件会分在两个文件里（上一段在 `.old`），只读主文件会让"最近一小时建了几次"
 * 这类窗口判据在轮转那一刻凭空少一段。按时间顺序读：先 .old 再主文件。
 *
 * 当前生产代码没有调用方：留着给排查 / 未来的导出入口用（审计行写了没人读等于没写）。
 */
export declare function readAgentHomeAudit(homeDir: string): Promise<AgentHomeAuditEvent[]>;
