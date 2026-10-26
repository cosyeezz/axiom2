import type { Session } from '../../../vendor/cbc-core/node/index.js';
export declare function withheldToolCalls(session: Session): string[];
export declare function withholdToolResult(item: any): void;
export declare function isToolResult(item: any): boolean;
export declare function toolResultText(item: any): string | undefined;
export declare function projectWithheldToolResults(session: Session, input: unknown): unknown;
