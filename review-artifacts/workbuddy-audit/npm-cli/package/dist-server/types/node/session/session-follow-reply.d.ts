import type { AgentInputItem } from '../../vendor/cbc-shared/node/index.js';
export declare const SESSION_WRITER_OCCUPIED_MESSAGE = "Persistent Session already has an external writer";
export interface LiveSessionFollowState {
    sessionId: string | null;
    writerOccupied: boolean;
}
export declare function resolveLiveSessionFollow(input: {
    liveSessionId?: string;
    ownerConnectionId?: string;
    ownerAlive?: boolean;
}): LiveSessionFollowState;
export declare function shouldRejectForeignWriter(input: {
    ownerConnectionId?: string;
    currentConnectionId?: string;
    ownerAlive?: boolean;
}): boolean;
/**
 * Whether another live connection must block this connection from writing.
 *
 * Only two Web UI connections may share a writer. The requester's clientInfo
 * is self-reported, so it must never let that requester bypass a native owner.
 * Unknown or disconnected owners retain the single-writer protection.
 */
export declare function foreignWriterBlocked(input: {
    requesterWebUi: boolean;
    ownerWebUi: boolean;
    foreignLiveOwner: boolean;
}): boolean;
export declare function canDeliverFollowReply(liveSessionId: string | undefined, targetId: string): boolean;
/**
 * 跟随回复的入站 items。`sessionId` = 收件会话自己的身份入口：Agent Home 的频道回执
 * 要按它认「你是谁」（已登记、无 jobId 的同事会话靠它，见 #125667 F6）。
 */
export declare function buildFollowReplyItems(text: string, sessionId: string): AgentInputItem[];
