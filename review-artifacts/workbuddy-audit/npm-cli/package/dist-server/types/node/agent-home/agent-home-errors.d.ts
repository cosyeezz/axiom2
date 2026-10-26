/**
 * Agent Home 的错误码单一映射表（建人/建频道 + 频道任务板，两张表一份形状）。
 *
 * 加/改一个错误只动本文件：domain 抛 code，工具层取 llmMessage，HTTP controller 取
 * httpStatus/httpMessage。别在三处各写一遍——这里连"表驱动构造器"也只有一份。
 */
export type AgentHomeCreateErrorCode = 'DIRECTORY_UNAVAILABLE' | 'INVALID_ACTOR' | 'INVALID_INPUT' | 'ENGINE_NOT_ALLOWED' | 'QUOTA_AGENTS' | 'QUOTA_CHANNELS' | 'DEPTH_EXCEEDED' | 'CHANNEL_MEMBERS' | 'MEMBER_NOT_FOUND' | 'ALREADY_MEMBER' | 'MEMBER_NOT_ALLOWED' | 'MAIN_AGENT_NOT_MEMBER' | 'LEAD_NOT_MEMBER' | 'PERMISSION_MODE_NOT_ALLOWED';
export type ChannelTaskErrorCode = 'CHANNEL_NOT_FOUND' | 'CHANNEL_NEED_ID' | 'DIRECTORY_UNAVAILABLE' | 'INVALID_ACTOR' | 'INVALID_TASK' | 'TASK_NOT_FOUND' | 'TASK_CLAIM_CONFLICT' | 'TASK_DONE' | 'TASK_FORBIDDEN' | 'TASK_DUPLICATE' | 'BOARD_FULL' | 'BOARD_WRITE_FAILED' | 'LEAD_ONLY' | 'MEMBER_NOT_FOUND';
/** 两张表共用的行形状：[码, http 状态, http 文案（英文，给调用方）, llm 文案（英文，给模型，要可执行）]。 */
export interface AgentHomeErrorSpec<C extends string = string> {
    code: C;
    httpStatus: number;
    httpMessage: string;
    llmMessage: string;
}
export declare function agentHomeCreateError(code: AgentHomeCreateErrorCode): AgentHomeErrorSpec<AgentHomeCreateErrorCode>;
export declare function channelTaskError(code: ChannelTaskErrorCode): AgentHomeErrorSpec<ChannelTaskErrorCode>;
