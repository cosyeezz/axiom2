import type { Session } from '../../vendor/cbc-core/node/index.js';
export declare function isProtectedProductPath(filePath: string): boolean;
export declare function isCreateModeProtectedWrite(session: Session | undefined, absolutePath: string): boolean;
