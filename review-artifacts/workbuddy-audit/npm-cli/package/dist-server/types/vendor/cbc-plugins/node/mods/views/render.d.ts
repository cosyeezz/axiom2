import { type JsonValue } from '../../../../cbc-worker/node/protocol/index.js';
import { type ModViewAction, type ModViewActionKind, type ModViewFrame } from './protocol';
export interface ViewActionBinding extends ModViewAction {
    run?: (value: unknown) => unknown;
}
/** Actions are opaque capabilities, replaced atomically only after a valid frame. */
export declare class ViewRenderRegistry {
    private bindings;
    serialize(tree: unknown, defaultPlugin?: string): ModViewFrame;
    get(id: string): ViewActionBinding | undefined;
    find(plugin: string, element: string, kind: ModViewActionKind): ViewActionBinding | undefined;
    clear(): void;
}
export declare function validateActionValue(kind: ModViewActionKind, value: JsonValue | undefined): void;
//# sourceMappingURL=render.d.ts.map