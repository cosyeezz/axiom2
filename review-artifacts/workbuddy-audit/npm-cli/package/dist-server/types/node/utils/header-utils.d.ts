export declare abstract class HeaderUtils {
    /**
     * Convert header array to headers object
     * @param headerArray Array of strings in format "Header-Key: Header-Value"
     * @returns Headers object
     */
    static convertHeaderArrayToObject(headerArray?: string[]): {
        [key: string]: string;
    } | undefined;
    /** Response header value from AxiosHeaders, fetch `Headers` or a plain object, case-insensitively. */
    static readResponseHeader(headers: unknown, name: string): string | undefined;
    /**
     * Response headers whose lowercased name matches `pattern`, keyed by lowercased name, from AxiosHeaders,
     * fetch `Headers` or a plain object. Multi-value headers are joined with `, `; control characters become
     * spaces, values are trimmed, bounded to `maxValueLength` and copied, and empty values are dropped.
     * Never throws: callers use it for diagnostics inside error paths.
     */
    static readResponseHeaders(headers: unknown, pattern: RegExp, maxValueLength?: number): Record<string, string>;
}
