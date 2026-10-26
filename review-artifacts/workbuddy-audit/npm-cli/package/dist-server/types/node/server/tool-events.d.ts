import type { Session } from '../../vendor/cbc-core/node/index.js';
import type { AcpTerminalPublisher } from '../acp/acp-protocol';
import { ServerFileChangePublisher } from './turn-diff';
export declare const fileChangePublisher: ServerFileChangePublisher;
/** Adapt existing tool callbacks into neutral subscribe() events in the Server composition. */
export declare class ServerTerminalPublisher implements AcpTerminalPublisher {
    private readonly terminals;
    private readonly disposed;
    private readonly output;
    notifyCreated(session: Session, params: Parameters<AcpTerminalPublisher['notifyCreated']>[1]): void;
    private owner;
    publishOutput(session: Session, terminalId: string, bytes: Buffer): void;
    flushOutput(_session: Session, terminalId: string): void;
    notifyExit(_session: Session, terminalId: string, status: Parameters<AcpTerminalPublisher['notifyExit']>[2], end?: Parameters<AcpTerminalPublisher['notifyExit']>[3]): void;
    disposeTerminal(terminalId: string): void;
    private emit;
}
