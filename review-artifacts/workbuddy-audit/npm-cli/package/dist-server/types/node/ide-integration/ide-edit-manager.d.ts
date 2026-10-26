/**
 * Manages IDE diff preview and input transformation workflow.
 * Coordinates between CLI confirmation and IDE editing (race condition).
 */
import { Logger } from '@celljs/core';
import { RunToolApprovalItem } from '../../vendor/cbc-shared/node/index.js';
import { Session } from '../../vendor/cbc-core/node/index.js';
export declare const IDEEditManager: unique symbol;
/** IDE diff preview info stored by IdeEditDiffPanel */
export interface IDEDiffPreview {
    tabName: string;
    idePromise: Promise<{
        accepted: boolean;
        finalContent?: string;
    }>;
    originalContent: string;
    proposedContent: string;
    filePath: string;
    lineEnding?: 'CRLF' | 'LF' | 'MIXED';
}
/** Transformed tool input after IDE editing */
export interface TransformedToolInput {
    transformed: boolean;
    arguments: any;
    shouldSkip: boolean;
    error?: string;
}
export interface IDEEditManager {
    /** Store IDE diff preview and monitor result (races with CLI approval) */
    storeIdeDiffPreview(item: RunToolApprovalItem, preview: IDEDiffPreview, session: Session, onIdeComplete: (accepted: boolean) => void): void;
    /** Handle CLI approval - close IDE tab and proceed with original args */
    handleCliApproval(item: RunToolApprovalItem): Promise<void>;
    /** Handle CLI rejection - close IDE tab and cancel */
    handleCliRejection(item: RunToolApprovalItem): Promise<void>;
    /** Check if item has pending IDE preview */
    hasPendingPreview(item: RunToolApprovalItem | null | undefined): boolean;
    /** Get transformed tool input (one-time consumption) */
    getTransformedInput(callId: string): TransformedToolInput | undefined;
}
export declare class IDEEditManagerImpl implements IDEEditManager {
    private ideService;
    protected readonly logger: Logger;
    private pendingIdeDiffPreviews;
    private transformedInputsMap;
    private completedItems;
    storeIdeDiffPreview(item: RunToolApprovalItem, preview: IDEDiffPreview, session: Session, onIdeComplete: (accepted: boolean) => void): void;
    handleCliApproval(item: RunToolApprovalItem): Promise<void>;
    handleCliRejection(item: RunToolApprovalItem): Promise<void>;
    getTransformedInput(callId: string): TransformedToolInput | undefined;
    /** Transform tool arguments based on IDE result */
    private transformArgumentsBasedOnIdeResult;
    hasPendingPreview(item: RunToolApprovalItem | null | undefined): boolean;
}
