/**
 * Shell Snapshot 服务协议定义
 *
 * Shell Snapshot 用于在 CLI 启动时捕获用户的 shell 环境配置，
 * 包括函数定义、别名、shell 选项等，并在后续命令执行时 source 该 snapshot，
 * 以确保命令在用户熟悉的环境中执行。
 */
export declare const SNAPSHOT_CREATION_TIMEOUT_MS = 10000;
export declare const SNAPSHOT_MAX_BUFFER = 1048576;
export declare const SNAPSHOT_DIR_NAME = "shell-snapshots";
/**
 * Shell Snapshot 服务接口
 */
export declare const ShellSnapshotService: unique symbol;
export interface ShellSnapshotService {
    /**
     * 获取或创建 shell snapshot
     * @returns snapshot 文件路径，如果创建失败则返回 undefined
     */
    getSnapshot(): Promise<string | undefined>;
    /**
     * 预热：提前开始创建 snapshot（不等待完成）
     * 应在应用启动时调用，这样首次执行命令时 snapshot 可能已经准备好
     */
    warmup(): void;
    /**
     * 清除缓存的 snapshot，强制重新创建
     */
    clearCache(): void;
    /**
     * In library runtime, when a session's residency starts: begins its own
     * snapshot, from the shell configuration as it is now. Calls made for the
     * session, its subagents' and teammates' included, use it until the
     * residency ends.
     */
    warmupSession(sessionId: string): void;
    /**
     * When the session's residency ends: removes its snapshot, and one still
     * being created once that ends. The next residency creates a new one.
     */
    releaseSession(sessionId: string): void;
}
/**
 * Shell 配置文件信息
 */
export interface ShellConfigFile {
    /** shell 类型 */
    shellType: 'bash' | 'zsh' | 'sh';
    /** 配置文件路径 */
    configPath: string;
    /** 配置文件是否存在 */
    exists: boolean;
}
/**
 * Snapshot 创建结果
 */
export interface SnapshotResult {
    /** snapshot 文件路径 */
    filePath: string;
    /** 文件大小 (bytes) */
    size: number;
    /** 创建时间 */
    createdAt: number;
}
/**
 * 获取 shell 配置文件路径
 *
 * - zsh -> ~/.zshrc
 * - bash -> 按优先级查找: ~/.bash_profile > ~/.bashrc > ~/.profile
 * - 其他 -> ~/.profile
 *
 * Windows Git Bash 环境会优先使用 HOME 环境变量作为用户主目录
 *
 * @param shellPath shell 可执行文件路径
 * @returns 配置文件信息
 */
export declare function getShellConfigFile(shellPath: string): ShellConfigFile;
/**
 * 获取 snapshot 存储目录
 * @param codebuddyHome CodeBuddy 主目录 (默认从 CODEBUDDY_CONFIG_DIR 环境变量或 ~/.codebuddy)
 */
export declare function getSnapshotDirectory(codebuddyHome?: string): string;
/**
 * 生成 snapshot 文件名
 * @param shellType shell 类型
 */
export declare function generateSnapshotFileName(shellType: 'bash' | 'zsh' | 'sh'): string;
/**
 * A session residency's snapshot file name. It carries the pid of the process
 * that owns it, so a later process can remove it once that process is gone.
 */
export declare function generateResidencySnapshotFileName(shellType: 'bash' | 'zsh' | 'sh', pid?: number): string;
/** The owning pid of a residency snapshot file name; undefined for any other name. */
export declare function residencySnapshotPid(fileName: string): number | undefined;
