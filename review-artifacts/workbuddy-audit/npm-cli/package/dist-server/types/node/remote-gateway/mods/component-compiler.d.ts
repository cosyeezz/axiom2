import { Mods } from '../../../vendor/cbc-plugins/node/index.js';
import { type JsonObject } from '../../../vendor/cbc-worker/node/protocol/index.js';
import { type ComponentDefinition } from './component-protocol';
export declare function componentId(value: unknown): string;
export declare function parseComponentDefinition(value: unknown): ComponentDefinition;
export declare function validateComponentProps(definition: ComponentDefinition, props: JsonObject): Promise<void>;
/** Virtual mounted compilation: generated code never executes or writes modules on the Gateway. */
export declare function compileComponent(definition: ComponentDefinition, id: string): Promise<Mods.CompiledViewMod>;
