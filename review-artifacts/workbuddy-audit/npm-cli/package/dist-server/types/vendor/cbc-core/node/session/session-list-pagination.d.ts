import type { Session } from './session-protocol';
export declare const DURABLE_SESSION_LIST_PAGE_SIZE = 50;
export type DurableSessionListCursorErrorReason = 'cursor_cwd_mismatch' | 'cursor_expired' | 'invalid_cursor';
export declare class DurableSessionListCursorError extends Error {
    readonly reason: DurableSessionListCursorErrorReason;
    constructor(reason: DurableSessionListCursorErrorReason, message: string);
}
export interface DurableSessionListPage {
    nextCursor: string | null;
    sessions: Session[];
}
export interface PaginateDurableSessionsOptions {
    cursor?: unknown;
    cwd: string | null;
    pageSize?: number;
}
export declare function getDurableSessionCwdOrUndefined(session: Session): string | undefined;
export declare function getDurableSessionCwd(session: Session): string;
export declare function durableSessionUpdatedAt(session: Session): number;
export declare function validateDurableSessionListCursor(value: unknown, cwd: string | null): void;
export declare function paginateDurableSessions(sessions: readonly Session[], options: PaginateDurableSessionsOptions): DurableSessionListPage;
//# sourceMappingURL=session-list-pagination.d.ts.map