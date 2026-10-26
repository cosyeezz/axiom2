/**
 * 平台类型枚举
 */
export declare enum Platform {
    WINDOWS = "windows",
    MACOS = "macos",
    LINUX = "linux"
}
export declare abstract class PlatformUtils {
    /**
     * 获取当前平台
     */
    static getCurrentPlatform(): Platform;
    /**
     * 是否 Linux 平台
     */
    static isLinux(): boolean;
    /**
     * 获取路径分隔符
     */
    static getPathSeparator(): string;
    /**
     * Option/Alt 键的展示标签：macOS 用 `⌥`，其它平台用 `Alt`。
     * 对齐 Codex（`⌥ + ↑` mac / `alt + ↑` Linux）与 Claude（Option+T mac）的键位文案习惯。
     */
    static optionKeyLabel(): string;
}
