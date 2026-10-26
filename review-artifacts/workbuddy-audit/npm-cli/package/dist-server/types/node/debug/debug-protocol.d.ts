export declare const DebugService: unique symbol;
export declare const DEBUG_MIDDLEWARE_PRIORITY: number;
export interface DebugFilter {
    include: string[];
    exclude: string[];
    isExclusive: boolean;
}
export interface DebugOptions {
    level?: 'debug' | 'info' | 'warn' | 'error';
}
export interface DebugConfig {
    isDebugEnabled: boolean;
    isDebugToStderr: boolean;
    debugFilter: DebugFilter | null;
}
export interface DebugService {
    /**
     * Initialize debug service with external configuration
     */
    initializeConfig(config: DebugConfig): void;
    /**
     * Clean up resources and subscriptions
     */
    dispose(): void;
    /**
     * Check if debug mode is enabled
     */
    isDebugEnabled(): boolean;
    /**
     * Check if debug output should go to stderr
     */
    isDebugToStderr(): boolean;
    /**
     * Log a debug message
     * @param message The message to log
     * @param options Debug options including log level
     */
    debug(message: string, options?: DebugOptions): void;
    /**
     * Get the current debug filter
     */
    getDebugFilter(): DebugFilter | null;
    /**
     * Check if a message should be debugged based on current filter
     * @param message The message to check
     */
    shouldDebugMessage(message: string): boolean;
    /**
     * Set whether multiline messages should be stringified
     * @param enabled Whether to stringify multiline messages
     */
    setStringifyMultiline(enabled: boolean): void;
    /**
     * Parse a string value as truthy
     * @param value The string value to parse
     */
    parseTruthy(value?: string): boolean;
    /**
     * Parse a debug filter string
     * @param filterString The filter string to parse
     */
    parseDebugFilter(filterString: string): DebugFilter | null;
}
