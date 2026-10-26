/**
 * Windows path utilities for bidirectional path conversion,
 * UNC path handling, and path safety validation.
 *
 * Complements the existing windowsPathToUnix() in shell-utils.ts with:
 *   - POSIX-to-Windows conversion
 *   - UNC path support
 *   - cygdrive path handling
 *   - Path safety checks (directory traversal prevention)
 */
export declare class WindowsPathUtils {
    /**
     * Convert a Windows path to POSIX (Git Bash / MSYS2 compatible).
     *
     * Examples:
     *   C:\Users\foo       → /c/Users/foo
     *   D:\Projects\test   → /d/Projects/test
     *   \\server\share     → //server/share
     *   \\?\C:\long\path   → /c/long/path
     */
    static toPosix(winPath: string): string;
    /**
     * Convert a POSIX path to Windows format.
     *
     * Examples:
     *   /c/Users/foo         → C:\Users\foo
     *   /d/Projects/test     → D:\Projects\test
     *   //server/share       → \\server\share
     *   /cygdrive/c/tmp      → C:\tmp
     */
    static toWindows(posixPath: string): string;
    /**
     * Normalize a path to the target style.
     */
    static normalize(inputPath: string, targetStyle: 'posix' | 'windows'): string;
    /**
     * Check if a path is a UNC path (\\server\share or //server/share).
     */
    static isUNC(p: string): boolean;
    /**
     * Check if a path appears to be a Windows path (has drive letter or UNC prefix).
     */
    static isWindowsPath(p: string): boolean;
    /**
     * Check if a path appears to be a POSIX path (starts with /).
     */
    static isPosixPath(p: string): boolean;
    /**
     * Check if inputPath stays within basePath (no directory traversal).
     *
     * Resolves both paths and verifies the resolved input is a prefix of the base.
     * This prevents attacks like: C:\project\..\..\..\Windows\System32
     */
    static isSafePath(inputPath: string, basePath: string): boolean;
    /**
     * Check if a path targets a dangerous system location.
     */
    static isDangerousPath(p: string): boolean;
}
