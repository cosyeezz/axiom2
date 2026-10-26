import { Mods } from '../../../vendor/cbc-plugins/node/index.js';
import type { AuthoredModDefinition } from './authored-mod-protocol';
/** Execute the approved source snapshot, never a graph read before or after validation. */
export declare function loadApprovedMod(entry: string, root: string, name: string, hash: string, library: string, log: (text: string) => void, validated?: (definition: AuthoredModDefinition) => Promise<void>): Promise<Mods.Register>;
