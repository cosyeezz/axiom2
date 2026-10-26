import type { AuthoredModDefinition } from './authored-mod-protocol';
import type { ComponentExample } from './component-examples';
export interface AuthoredModExample {
    id: string;
    definition: AuthoredModDefinition;
    dependencies?: readonly ComponentExample[];
}
/** Ordinary approved Mods source: UI and Agent tools share these business functions. */
export declare const AUTHORED_MOD_EXAMPLES: readonly AuthoredModExample[];
