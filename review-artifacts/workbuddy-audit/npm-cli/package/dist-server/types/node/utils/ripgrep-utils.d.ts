export interface RipgrepConfig {
    mode: 'system' | 'builtin';
    command: string;
    args: string[];
}
/**
 * Result handler callback for stream processing
 */
export type RgResultHandler = (line: string) => string | void;
export declare const MAX_RG_RESULTS = 200000;
export declare function isFileGlobCaseInsensitive(targetPlatform?: NodeJS.Platform): boolean;
export declare const RIPGREP_DLL_INIT_FAILED_CODE = "ERIPGREP_DLL_INIT_FAILED";
export interface RgStreamExecutorOptions {
    cwd?: string;
    signal?: AbortSignal;
    acceptResult?: (line: string) => boolean;
    /** 分批搜索时限制本轮可接收的结果，默认使用全局上限。 */
    maxResults?: number;
    /** 文件枚举使用 NUL 分隔，避免拆开带换行的文件名。 */
    nullSeparated?: boolean;
    onResult?: RgResultHandler;
    onLimitHit?: () => void;
    timeout: number;
}
/** Execute ripgrep while preserving its structured executable/argv boundary. */
export type RgStreamExecutor = (config: RipgrepConfig, args: string[], options: RgStreamExecutorOptions) => Promise<void>;
/**
 * ripgrep 搜索超过预算（默认 30s）。
 * message 保持 `Search timeout after <N>ms`，N 即本次搜索的完整预算，而不是某个阶段的剩余时间。
 */
export declare class RgSearchTimeoutError extends Error {
    readonly timeoutMs: number;
    constructor(timeoutMs: number);
}
/**
 * File search options
 */
export interface RgFilesSearchOptions {
    searchDir: string;
    onResult?: RgResultHandler;
    signal?: AbortSignal;
    ignorePatterns?: string[];
    sort?: 'none' | 'path' | 'modified';
    /** Whether to follow symbolic links (default: false) */
    followSymlinks?: boolean;
    /** Maximum directory depth to search (default: unlimited) */
    maxDepth?: number;
    /** Maximum accepted file paths before stopping. */
    maxResults?: number;
    /** Called when another accepted path proves the file result limit was exceeded. */
    onLimitHit?: () => void;
    /** Overall timeout for this file enumeration. */
    timeout?: number;
}
/**
 * Content search options
 */
export interface RgContentSearchOptions {
    searchPath: string;
    outputMode?: 'content' | 'files_with_matches' | 'count';
    caseInsensitive?: boolean;
    glob?: string;
    type?: string;
    beforeContext?: number;
    afterContext?: number;
    context?: number;
    lineNumbers?: boolean;
    multiline?: boolean;
    onResult?: RgResultHandler;
    signal?: AbortSignal;
    ignorePatterns?: string[];
    /** 限制整次搜索接收的结果条数；用于将调用方的分页上限下推到 rg。 */
    maxResults?: number;
    /** Optional content-search-only executor, used to run rg through sandbox-cli. */
    streamExecutor?: RgStreamExecutor;
    /**
     * 搜索超时时的回调。提供后 searchContent 不再抛错，而是返回超时前已收集的部分结果，
     * 由调用方决定如何提示模型；不提供则保持抛出 RgSearchTimeoutError。
     */
    onTimeout?: (info: {
        timeoutMs: number;
    }) => void;
}
/**
 * Utility class for managing ripgrep (rg) availability and installation
 */
export declare class RipGrepUtils {
    /**
     * Maximum number of results to return (memory safety limit)
     * @private
     */
    private static readonly MAX_RESULTS;
    /**
     * Default timeout for ripgrep searches (milliseconds)
     * @private
     */
    private static readonly DEFAULT_TIMEOUT;
    /**
     * Checks if builtin ripgrep should be used based on USE_BUILTIN_RIPGREP environment variable.
     * Returns false when USE_BUILTIN_RIPGREP=0, otherwise returns true (prefer builtin by default).
     */
    private static shouldUseBuiltinRipgrep;
    /**
     * Checks if builtin ripgrep is available.
     */
    private static isBuiltinRipgrepAvailable;
    private static getBuiltinRipgrepConfig;
    private static getDefaultBuiltinRipgrepConfig;
    /**
     * Checks if `rg` exists in builtin vendor directory or system PATH.
     * Prioritizes builtin ripgrep over system ripgrep.
     */
    static canUseRipgrep(): Promise<boolean>;
    private static checkRipgrepAvailability;
    /**
     * Ensures `rg` is available, returns config with priority: builtin > system.
     * When USE_BUILTIN_RIPGREP=0, only uses system ripgrep.
     */
    static ensureRgConfig(): Promise<RipgrepConfig | undefined>;
    /**
     * Normalize ignore patterns to ripgrep format
     * @private
     */
    private static normalizeIgnorePatterns;
    /**
     * Get ignore patterns for ripgrep
     * @private
     */
    private static getIgnorePatternsForRg;
    /**
     * 读取 settings.disableUEAutoExclude 开关
     * @private
     */
    private static isUEAutoExcludeDisabled;
    /**
     * Unified ripgrep stream execution
     * @private
     */
    private static executeRgStream;
    private static hasPathSeparatorInsideBraces;
    private static isFileGlobCaseInsensitive;
    private static getTypeGlob;
    private static matchesFileGlob;
    private static getContentResultPath;
    /**
     * Build ripgrep arguments for file search
     * @private
     */
    private static buildFilesArgs;
    /**
     * Build ripgrep arguments for content search
     * @private
     */
    private static buildContentArgs;
    /**
     * Search files using ripgrep
     * @param pattern - Glob pattern
     * @param options - Search options
     * @returns Array of matching file paths
     */
    static searchFiles(pattern: string, options: RgFilesSearchOptions): Promise<string[]>;
    /**
     * 提取正 glob 开头不含通配符的目录段，如 `packages/**\/*.ts` -> `packages`。
     * 仅用于缩小 rg 的搜索入口；是否真正匹配仍由完整 glob 的后置过滤决定。
     */
    private static getGlobDirectoryPrefix;
    /**
     * Search file contents using ripgrep
     * @param pattern - Regular expression pattern
     * @param options - Search options
     * @returns Array of matching lines
     */
    static searchContent(pattern: string, options: RgContentSearchOptions): Promise<string[]>;
}
