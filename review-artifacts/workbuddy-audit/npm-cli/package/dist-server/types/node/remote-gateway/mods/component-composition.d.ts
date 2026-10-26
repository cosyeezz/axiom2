import { Mods } from '../../../vendor/cbc-plugins/node/index.js';
import type { ComponentReader } from './component-package';
import type { ComponentDefinition } from './component-protocol';
export declare const COMPONENT_COMPOSITION_LIMITS: {
    readonly depth: 8;
    readonly components: 32;
    readonly bytes: number;
};
/** Published references are expanded at compile time, pinned and isolated per occurrence. */
export declare function compileComponentComposition(definition: ComponentDefinition, id: string, store: ComponentReader, ancestors?: string[], depth?: number, budget?: {
    components: number;
    bytes: number;
}, stateId?: string, repeated?: boolean, componentId?: string): Promise<Mods.CompiledViewMod>;
