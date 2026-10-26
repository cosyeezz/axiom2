import type { ComponentDefinition } from './component-protocol';
export interface ComponentExample {
    id: string;
    definition: ComponentDefinition;
}
/** Examples are ordinary definitions: adoption saves a draft and never silently publishes/mounts. */
export declare const COMPONENT_EXAMPLES: readonly ComponentExample[];
