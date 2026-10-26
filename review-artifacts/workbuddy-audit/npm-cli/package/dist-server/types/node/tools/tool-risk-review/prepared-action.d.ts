import { createToolActionHash } from './action-projection';
import type { PreparedAction, ToolIdentity } from './protocol';
export type PrepareActionResult = {
    status: 'prepared';
    action: PreparedAction;
} | {
    status: 'incomplete';
    reason: 'identity_missing' | 'arguments_unserializable';
};
export declare function prepareToolAction(input: {
    toolCallId: string;
    toolIdentity: ToolIdentity;
    inputSchemaFingerprint?: string;
    toolInput: unknown;
}, hashAction?: typeof createToolActionHash): PrepareActionResult;
