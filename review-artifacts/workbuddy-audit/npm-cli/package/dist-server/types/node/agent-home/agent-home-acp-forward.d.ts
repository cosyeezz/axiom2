/**
 * 同事来信走 JobInboxConsumer → agentService.run，不经过 ACP prompt。
 * attachInboxTurnToAcp 把 1:1 卡片推给已打开的对话；这一轮真的在跑模型时再接上流。
 * 不下令回不回。
 */
import { type Session } from '../../vendor/cbc-core/node/index.js';
import { isAgentHomeChannelEnvelope, isAgentHomeColleagueEnvelope, looksLikeAgentHomeEnvelope } from '../../vendor/cbc-core/node/index.js';
export { isAgentHomeChannelEnvelope, isAgentHomeColleagueEnvelope, looksLikeAgentHomeEnvelope, };
export declare function attachInboxTurnToAcp(session: Session, text: string, options?: {
    stream?: boolean;
}): void;
