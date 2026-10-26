export declare const GitIgnoreFilter: unique symbol;
export interface GitIgnoreFilter {
    isIgnored(filePath: string): boolean;
    getPatterns(): string[];
}
