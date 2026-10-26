/**
 * 叫醒协议：同事来信和用户打字走同一个「开一轮」的槽。
 *
 * 给模型看的不是用户说话，是一条入站 MessageColleague 回执
 *（action=incoming, from, text）。回不回、告诉用户、还是闭嘴，仍是模型自己的事。
 * 用户聊天里的「消息来自」卡片走 ACP，不靠这条 user message。
 */
import type { Session } from '../../vendor/cbc-core/node/index.js';
import { type AgentInputItem } from '../../vendor/cbc-shared/node/index.js';
export interface AgentHomeEnvelope {
    /** 每封信的稳定主键；旧信封可能没有。 */
    messageId?: string;
    /** 盘上发件人主键：agent id。旧信封可能是显示名。 */
    id: string;
    /** 给模型 / UI 看的显示名 */
    from: string;
    summary?: string;
    content: string;
}
export declare function parseAgentHomeEnvelope(text: string): AgentHomeEnvelope | undefined;
export declare function formatAgentHomeEnvelope(speaker: string | {
    id: string;
    name?: string;
}, content: string, summary?: string, 
/** undefined = 新信生成 id；null = 保留旧无 id 格式。 */
messageId?: string | null): string;
/** 合成回执：有 from、没有 action=send/list。发给同事的真调用不会走这里。 */
export declare function parseIncomingColleagueToolArgs(raw: unknown): AgentHomeEnvelope | undefined;
/** 给模型的形状：入站 MessageColleague（action=incoming），不是用户回车，也不是已发出的 send。 */
export declare function createColleagueReceiptItems(text: string): AgentInputItem[];
export declare function historyAlreadyHasEnvelope(session: Session | undefined, text: string): boolean;
/** 收件箱已经换成回执时，给 ACP 卡片还原信封。只看这一轮末尾。 */
export declare function envelopeFromIncomingColleagueReceipt(input: readonly AgentInputItem[]): string | undefined;
