import type { AgentInputItem } from '../../../vendor/cbc-shared/node/index.js';
/** Explicit Mod references are separate from file references and never inferred from a display name. */
export declare function referencedMods(input: readonly AgentInputItem[]): string[];
export interface ModReference {
    id: string;
    packageId: string;
    revision: number;
    installed: boolean;
    current: boolean;
}
export declare function modReferenceMessage(reference: ModReference | {
    id: string;
    unavailable: true;
}): string;
