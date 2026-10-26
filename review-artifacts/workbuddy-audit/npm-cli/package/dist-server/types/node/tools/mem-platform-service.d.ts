import { RestOperations } from '@celljs/http';
import { AuthenticationManager } from '@genie/authentication';
import { ProductManager } from '@genie/product';
import { Logger } from '@genie/telemetry';
import type { RunContext } from '@openai/agents';
import { Session } from '../session';
export declare const MemPlatformService: unique symbol;
export interface MemCurateAccepted {
    accepted: boolean;
    taskId: string;
    taskStatus: string;
    requestId?: string;
}
export interface MemAnswerResult {
    answer: string;
    storageVersion: number;
    result: unknown;
    requestId?: string;
}
export interface MemPlatformService {
    curate(content: string, context: RunContext<Session>): Promise<MemCurateAccepted>;
    answer(query: string, context: RunContext<Session>): Promise<MemAnswerResult>;
    extractErrorMessage(error: unknown): string;
}
/** 与 agentmem 服务端同口径：按 Unicode code point（Go rune）计数。 */
export declare const MEM_CURATE_MAX_RUNES: number;
export declare const MEM_ANSWER_MAX_RUNES: number;
export declare function countRunes(text: string): number;
export declare class MemPlatformServiceImpl implements MemPlatformService {
    protected readonly restOperations: RestOperations;
    protected readonly authenticationManager: AuthenticationManager;
    protected readonly productManager: ProductManager;
    protected readonly logger: Logger;
    curate(content: string, context: RunContext<Session>): Promise<MemCurateAccepted>;
    answer(query: string, context: RunContext<Session>): Promise<MemAnswerResult>;
    extractErrorMessage(error: unknown): string;
    private request;
    private prepareRequest;
}
