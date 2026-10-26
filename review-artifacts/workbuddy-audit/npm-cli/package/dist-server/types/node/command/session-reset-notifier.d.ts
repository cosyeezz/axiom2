import { Session } from '../../vendor/cbc-core/node/index.js';
/**
 * Minimal logger shape accepted by the notifier (matches @genie/telemetry Logger).
 */
export interface SessionResetLogger {
    info?(...args: unknown[]): void;
    warn?(...args: unknown[]): void;
}
export declare function buildSessionResetNotification(previousSessionId: string, newSessionId: string): {
    sessionId: string;
    update: {
        sessionUpdate: 'session_info_update';
        _meta: Record<string, unknown>;
    };
};
/**
 * Broadcast a sessionReset notification to connections attached to the old session.
 *
 * Session-switch commands (/resume, /clear, /fork) previously unicast this
 * notification to the single connectionId stored in `session.meta.acpConnectionId`.
 * That id goes stale whenever the browser reconnects (new connectionId) or a
 * second client (another tab, script, mobile page) loads a session and
 * overwrites the meta — the notification was then silently dropped and the
 * Web UI appeared frozen on session switch until a full page reload.
 *
 * A Web UI bus subscription is authorized against AcpAgent.currentSessionId.
 * Flush the control notification to the old stream before retargeting its
 * attachments so every subscribed page receives it. ACP still carries the
 * notification to the originator even when bus owns conversation updates.
 */
export declare function notifySessionResetToAllConnections(session: Session, logger?: SessionResetLogger, previousSessionId?: string): Promise<void>;
