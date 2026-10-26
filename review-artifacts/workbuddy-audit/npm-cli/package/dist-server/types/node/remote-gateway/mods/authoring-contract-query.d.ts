export declare const AUTHORING_CONTRACT_SECTIONS: readonly ["summary", "full", "operations", "schemas", "browser", "ui", "examples", "blueprint", "packages", "sourceComposition", "instructions"];
export declare const AUTHORING_CONTRACT_QUERY_SCHEMA: {
    type: string;
    additionalProperties: boolean;
    properties: {
        section: {
            enum: ("summary" | "full" | "instructions" | "ui" | "browser" | "blueprint" | "examples" | "operations" | "sourceComposition" | "schemas" | "packages")[];
        };
        name: {
            type: string;
            minLength: number;
            maxLength: number;
        };
    };
};
/** Select from the same executable author contract; no separately maintained capability catalog. */
export declare function queryAuthoringContract(kind: 'components' | 'resident' | 'skins', request?: unknown): Record<string, unknown>;
