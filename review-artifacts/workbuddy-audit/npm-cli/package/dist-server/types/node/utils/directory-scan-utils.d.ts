/**
 * Directory scanning utilities with built-in symlink cycle detection
 * Prevents infinite recursion when scanning directories with circular symlinks
 */
export interface ScanFileInfo {
    /** Absolute file path */
    fullPath: string;
    /** File name (e.g., 'file.md') */
    fileName: string;
    /** Relative path from baseDir (e.g., 'agents/foo.md') */
    relativePath: string;
}
export interface DirectoryScanOptions {
    /** Maximum recursion depth (default: 100) */
    maxDepth?: number;
    /** File extension filter (e.g., '.md') */
    extension?: string;
    /** Custom error handler */
    onError?: (error: Error, path: string) => void;
    /** Whether directory symlinks may be traversed (default: true) */
    followDirectorySymlinks?: boolean;
    /** Maximum number of directory entries to process across the scan */
    maxEntries?: number;
    /** Cancels the scan between filesystem operations */
    signal?: AbortSignal;
}
export declare class DirectoryScanUtils {
    /**
     * Core scan method returning rich file information
     * Resolves to ScanFileInfo with fullPath, fileName, and relativePath
     * @param baseDir Starting directory path
     * @param options Scan options (maxDepth, extension, onError)
     * @returns Array of ScanFileInfo for all files found
     */
    static scan(baseDir: string, options?: DirectoryScanOptions): Promise<ScanFileInfo[]>;
    /**
     * Get files with specific extension
     * @param baseDir Starting directory path
     * @param extension File extension (e.g., '.md')
     * @param options Scan options
     * @returns Array of ScanFileInfo for matching files
     */
    static getFilesByExtension(baseDir: string, extension: string, options?: DirectoryScanOptions): Promise<ScanFileInfo[]>;
    /**
     * Get files matching a custom predicate
     * @param baseDir Starting directory path
     * @param predicate Filter function receiving ScanFileInfo
     * @param options Scan options
     * @returns Array of matching ScanFileInfo
     */
    static getFilesWhere(baseDir: string, predicate: (file: ScanFileInfo) => boolean, options?: DirectoryScanOptions): Promise<ScanFileInfo[]>;
    /**
     * Scan with custom callback for each file
     * @param baseDir Starting directory path
     * @param callback Function called for each file, return value is collected
     * @param options Scan options
     * @returns Array of callback results
     */
    static scanDirectory<T>(baseDir: string, callback: (file: ScanFileInfo) => T | undefined, options?: DirectoryScanOptions): Promise<T[]>;
    /**
     * Get all files recursively
     * @param baseDir Starting directory path
     * @param extension Optional file extension filter (e.g., '.md')
     * @returns Array of file paths
     */
    static getAllFiles(baseDir: string, extension?: string): Promise<string[]>;
}
