import type { AuthoredMod } from './authored-mod-protocol';
export declare function modSourceInventory(mod: AuthoredMod): Array<{
    file: string;
    bytes: number;
    lines: number;
}>;
/** Read one draft source window; the revision guard prevents joining pieces from different edits. */
export declare function readModSource(mod: AuthoredMod, request: Record<string, unknown>): Record<string, unknown>;
