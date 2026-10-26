import type { ModsToolCall } from '../../vendor/cbc-core/node/index.js';
import { Mods } from '../../vendor/cbc-plugins/node/index.js';
/** Official `ToolCallResult.text`: the result as the model reads it, text blocks joined. */
export declare function toolResultText(result: unknown): string;
export declare class ToolCallDeniedByMod extends Error {
    readonly tool: string;
    constructor(tool: string, reason: string);
}
type ToolCallRuntime = Pick<Mods.ModsRuntime, 'dispatch'> & {
    readonly hooks?: Pick<Mods.HooksRegistry, 'runOutsideHooks'>;
};
/** Shared continuation adapter; callers own runtime selection and authorization. */
export declare function dispatchModsToolCall<T>(identity: ModsToolCall, run: (input: unknown) => Promise<T>, runtime: ToolCallRuntime, flatInput: boolean): Promise<T>;
export {};
