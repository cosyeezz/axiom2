import { type SessionManager } from '../../vendor/cbc-core/node/index.js';
import type { Mods } from '../../vendor/cbc-plugins/node/index.js';
import { type ModsCommandManager } from '../command/command-manager';
import { type ToolManager } from '../tools/tool-protocol';
export interface ModsCommandToolDependencies {
    commandManager: ModsCommandManager;
    toolManager: ToolManager;
    sessionManager: Pick<SessionManager, 'addHistory'>;
    runtime: () => Mods.ModsRuntime | undefined;
    /** A mod's agent type (`AgentManagerImpl.registerModAgent`): resolves its full name. */
    registerAgent?(plugin: string, spec: Record<string, unknown>): Promise<string>;
}
export type ModsCommandToolBindings = Pick<Mods.HostBindings, 'commands' | 'tools' | 'registerCommand' | 'registerTool' | 'registerAgent'> & {
    unregisterCommand(name: string, plugin?: string): Promise<void>;
    unregisterTool(name: string, plugin?: string): Promise<void>;
    releasePlugin(plugin: string): Promise<void>;
    isCommandUnregistered(name: string): boolean;
    dispose(): Promise<void>;
};
/** Bootstrap injects the managers once and the runtime by getter (not a startup snapshot). */
export declare function createModsCommandToolBindings(deps: ModsCommandToolDependencies): ModsCommandToolBindings;
/**
 * Text/image parts when a Mod tool answers MCP content with at least one valid image block; undefined otherwise
 * (text-only answers keep the existing text projection).
 */
export declare function modResultWithImages(result: unknown): Array<{
    type: string;
    [key: string]: unknown;
}> | undefined;
