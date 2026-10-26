import type { ModsBridge } from '../../vendor/cbc-core/node/index.js';
import { Mods } from '../../vendor/cbc-plugins/node/index.js';
type AgentBridgeOptions = {
    readonly mode: 'cli';
} | {
    readonly mode: 'server';
    readonly lifetime: AbortSignal;
    readonly signal: (request?: AbortSignal) => AbortSignal;
    readonly report: (message: string) => void;
};
/**
 * Agent-to-Mods adaptation shared by CLI and Server hosts. Runtime registration,
 * session capabilities, logging and disposal belong to the caller.
 *
 * CLI keeps its template-time context and completed-result prompt fold. Server
 * captures input at next(), folds first-message context and owns a per-run tool
 * view. These existing differences are explicit; sharing code must not switch
 * the CLI to Server submission, rendering or tool-placement semantics.
 */
export declare function createModsAgentBridge(runtime: Pick<Mods.ModsRuntime, 'dispatch'>, options: AgentBridgeOptions): ModsBridge;
export {};
