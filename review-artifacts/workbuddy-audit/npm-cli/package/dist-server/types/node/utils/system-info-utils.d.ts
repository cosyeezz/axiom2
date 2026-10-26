export interface SystemInfo {
    osType?: string;
    osVersion?: string;
    platform?: string;
    arch?: string;
    nodeVersion?: string;
    npmVersion?: string;
    terminalType?: string;
    shell?: string;
    isGitRepository?: boolean;
    gitBranch?: string;
    systemLocale?: string;
    timezone?: string;
}
export declare abstract class SystemInfoUtils {
    /**
     * 获取完整的系统信息
     */
    static getSystemInfo(): SystemInfo;
    /**
     * 获取操作系统类型
     */
    static getOSType(): string;
    /**
     * 获取操作系统版本
     */
    static getOSVersion(): string;
    /**
     * 获取操作系统平台
     */
    static getPlatform(): string;
    /**
     * 获取系统架构
     */
    static getArch(): string;
    /**
     * 获取Node.js版本
     */
    static getNodeVersion(): string;
    /**
     * 获取NPM版本
     */
    static getNpmVersion(): string | undefined;
    /**
     * 获取终端类型
     */
    static getTerminalType(): string | undefined;
    /**
     * 获取Shell类型
     */
    static getShell(): string | undefined;
    /**
     * 检查是否在Git仓库中
     */
    static isInGitRepository(): boolean;
    /**
     * 获取当前Git分支
     */
    static getGitBranch(): string | undefined;
    /**
     * 获取系统语言环境
     */
    static getSystemLocale(): string | undefined;
    /**
     * 获取时区信息
     */
    static getTimezone(): string | undefined;
    /**
     * 获取CLI版本信息
     */
    static getCliVersion(): string;
    /**
     * 获取内存使用情况(MB)
     */
    static getMemoryUsage(): number | undefined;
    /**
     * 获取系统可用内存(MB)
     */
    static getAvailableMemory(): number | undefined;
    /**
     * 获取CPU核心数
     */
    static getCpuCores(): number | undefined;
    /**
     * 获取用户主目录
     */
    static getUserHome(): string | undefined;
    /**
     * 获取当前工作目录
     */
    static getWorkingDirectory(): string | undefined;
    /**
     * 获取系统 shell 子进程输出所用的字符编码。
     * Windows 子进程（如系统错误信息）默认使用 ANSI 代码页（如简体中文 cp936/GBK），
     * 而非 UTF-8，直接用 Buffer.toString() 会产生乱码。
     * 通过 `chcp` 读取活动代码页并缓存结果。
     */
    private static _systemEncoding;
    static getSystemEncoding(): string;
}
