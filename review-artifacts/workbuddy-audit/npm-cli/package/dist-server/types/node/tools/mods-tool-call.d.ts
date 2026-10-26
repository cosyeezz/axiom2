import { type ModsToolCall } from '../../vendor/cbc-core/node/index.js';
import { Mods } from '../../vendor/cbc-plugins/node/index.js';
export { ToolCallDeniedByMod } from '../hooks/mods-tool-call';
export type ToolCallIdentity = ModsToolCall;
/**
 * Dispatch around a lazy continuation. Without an explicit runtime this is the
 * `tool.call` boundary itself (`tool-call-boundary.ts`); a Mod's own tool
 * passes the runtime that owns it. Clone input so a hook cannot mutate the
 * caller's captured arguments.
 */
export declare function throughModsToolCall<T>(identity: ToolCallIdentity, run: (input: unknown) => Promise<T>, runtime?: Mods.ModsRuntime, flatInput?: boolean): Promise<T>;
/**
 * Official `tool.describe`: the description and whether the tool is deferred go
 * down the chain; mods may not replace a built-in security schema.
 */
export declare function throughModsToolDescription(name: string, description: string, runtime?: Mods.ModsRuntime, signal?: AbortSignal, isDeferred?: boolean): Promise<{
    description: string;
    isDeferred?: boolean;
}>;
