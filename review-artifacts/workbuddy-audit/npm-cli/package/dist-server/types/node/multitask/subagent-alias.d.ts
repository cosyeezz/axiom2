export declare class IllegalMultitaskSubagentTypeError extends Error {
    constructor(raw: string);
}
/** Preserve exact live-catalog names; only the empty default and fork safety gate are special. */
export declare function normalizeSubagentType(raw?: string | null): string;
