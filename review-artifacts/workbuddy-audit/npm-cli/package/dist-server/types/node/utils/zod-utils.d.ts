import { z } from 'zod';
/**
 * Zod utility functions for tool parameter validation
 */
export declare namespace ZodUtils {
    /**
     * Detect whether a value is a Zod schema using duck typing.
     *
     * Uses duck typing instead of `instanceof` to remain correct across multiple
     * Zod versions (v3 / v4) and across duplicate module instances that can arise
     * in a monorepo. Both `parse` and `safeParse` are stable public methods on
     * every Zod schema. This is a strong heuristic — plain JSON Schema objects
     * (plain POJOs) do not have these methods, but any object that happens to
     * carry both will also pass this check.
     */
    function isZodSchema(value: unknown): value is z.ZodTypeAny;
    /**
     * Format Zod validation error into a human-readable message
     *
     * @param error - Zod validation error
     * @param params - Original parameters that failed validation
     * @returns Human-readable error message
     *
     * @example
     * // Instead of: [{"code":"invalid_type","expected":"number","received":"string","path":["offset"],"message":"Expected number, received string"}]
     * // Returns: Parameter "offset" expected number, but received string (value: "10")
     */
    function formatError(error: z.ZodError, params?: unknown): string;
    /**
     * Validate parameters and return formatted error message if invalid
     *
     * @param schema - Zod schema to validate against
     * @param params - Parameters to validate
     * @returns Formatted error message or undefined if valid
     */
    function validate<T extends z.ZodType>(schema: T, params: unknown): string | undefined;
}
