import { type Session } from '../../vendor/cbc-core/node/index.js';
import { Mods } from '../../vendor/cbc-plugins/node/index.js';
export interface FunctionalHookBindingContext {
    getSession(): Session;
    cwd(): string;
    report(message: string): void;
    pluginRoots?: readonly string[];
}
/** Server bindings resolve the owning session at invocation time, never getCurrent(). */
export declare function createFunctionalHookBindings(host: FunctionalHookBindingContext): Mods.HostBindings;
