import { type Session } from '../../vendor/cbc-core/node/index.js';
import type { Mods } from '../../vendor/cbc-plugins/node/index.js';
type Bindings = Pick<Mods.HostBindings, 'model' | 'messages' | 'turns' | 'repo' | 'surface' | 'surfaces' | 'settings' | 'abortTurn' | 'version' | 'copy' | 'mcpCall' | 'mcpConnect' | 'modelComplete' | 'modelFork' | 'authorize' | 'composeSections' | 'append' | 'send'>;
export declare function sessionVersionOf(version: string, builtAt?: string): {
    version: string;
    base?: string;
    builtAt?: string;
};
export declare function createModsHostBindings(getSession: () => Session, isInteractive: () => boolean): Bindings;
export {};
