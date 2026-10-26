import type { ReadSessionOptions, SessionKey } from './types';
export declare function validateSessionComponent(value: string, name: string): void;
export declare function childSessionId(subpath: string): string;
export declare function sessionAddress(session: string | SessionKey, options: ReadSessionOptions): {
    sessionId: string;
    cwd: string;
    key: SessionKey;
};
