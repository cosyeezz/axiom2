export declare class ModViewError extends Error {
    readonly status: number;
    readonly code: string;
    readonly name = "ModViewError";
    constructor(status: number, code: string, message: string);
}
export declare function requireViewRecord(value: unknown, fields: readonly string[], path?: string): Record<string, unknown>;
export declare function requireViewString(value: unknown, name: string): string;
//# sourceMappingURL=request-contract.d.ts.map