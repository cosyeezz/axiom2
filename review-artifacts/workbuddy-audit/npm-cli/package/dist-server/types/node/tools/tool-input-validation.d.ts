import type { Options, ValidateFunction } from 'ajv';
/** Keep legacy schemas on Draft-07; newer MCP schemas declare their dialect. */
export declare function createToolInputAjv(schema: object, options: Options): Promise<import("ajv/dist/core").default>;
/** Same non-coercing JSON Schema validation for registration and folded input. */
export declare function compileToolInputValidator(schema: object): Promise<ValidateFunction>;
export declare function validateToolInput(name: string, schema: object, input: unknown): Promise<void>;
