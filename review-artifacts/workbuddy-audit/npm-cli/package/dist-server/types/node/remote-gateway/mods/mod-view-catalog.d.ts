import { type Session, type SessionManager } from '../../../vendor/cbc-core/node/index.js';
import { Mods, type PluginManager } from '../../../vendor/cbc-plugins/node/index.js';
interface Dependencies {
    sessionManager: Pick<SessionManager, 'getWiredInMemory' | 'sessionSubject'>;
    pluginManager: Pick<PluginManager, 'getActivePlugins'>;
    pageSession?(id: string): Session | undefined;
}
/** Catalog operations read the committed active plugins, never install or evaluate them. */
export declare function createModViewCatalog(deps: Dependencies): Mods.ModViewCatalog;
export {};
