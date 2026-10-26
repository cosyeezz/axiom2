import { Logger } from '@celljs/core';
import { ShellSnapshotService } from './shell-snapshot-protocol';
/**
 * Shell Snapshot 服务实现
 *
 * 1. 检测 shell 类型 (bash/zsh)
 * 2. 查找对应的配置文件 (.bashrc/.zshrc)
 * 3. 生成 snapshot 脚本并执行
 * 4. 缓存 snapshot 文件路径供后续使用
 */
export declare class ShellSnapshotServiceImpl implements ShellSnapshotService {
    protected readonly logger: Logger;
    private readonly processSlot;
    private readonly sessionSlots;
    private disposed;
    private readonly creations;
    private readonly files;
    private exitCleanup;
    private swept;
    protected init(): void;
    /**
     * 预热：提前开始创建 snapshot（不等待完成）
     * 与 Claude Code 行为一致：在 shell provider 创建时就启动 snapshot 创建
     */
    warmup(): void;
    warmupSession(sessionId: string): void;
    releaseSession(sessionId: string): void;
    private warm;
    private track;
    /** Drain all snapshot callbacks while the host's dependencies are still available. */
    dispose(): Promise<void>;
    getSnapshot(): Promise<string | undefined>;
    clearCache(): void;
    /**
     * In library runtime a call made for a session uses its root session's
     * residency snapshot, as the shell environment policy asks for the root
     * session; anything else uses the process's.
     */
    private slotForCaller;
    private sessionSlot;
    private clearSlot;
    private removeFile;
    /**
     * 创建 shell snapshot
     */
    private createSnapshot;
    /**
     * 每个进程第一次创建驻留 snapshot 时，在后台删除已退出进程留下的驻留 snapshot：
     * 文件名里的 pid 不是本进程且该进程已不存在（`ESRCH`）。命令行的 snapshot 不碰。
     */
    private sweepResidencySnapshots;
    /**
     * 清理部分创建的 snapshot 文件
     * 在创建失败（如超时）时调用，避免留下不完整的文件
     */
    private cleanupPartialSnapshot;
    /**
     * 生成 snapshot 脚本的 FIY 函数逻辑
     *
     */
    private generateSnapshotScript;
    /**
     * 生成环境导出脚本（函数、选项、别名）。
     *
     * 设计原则：只序列化目标 shell 能可靠重放的状态。
     * - bash / zsh：保留函数、选项、别名
     * - sh：仅保留稳定的导出环境变量，避免混入 bash 专属语法
     */
    private generateEnvironmentExportScript;
    /**
     * 生成 zsh 环境导出脚本。
     */
    private generateZshEnvironmentExportScript;
    /**
     * 生成 bash 环境导出脚本。
     */
    private generateBashEnvironmentExportScript;
    /**
     * 生成最小 POSIX sh 环境导出脚本。
     * 仅保留稳定的导出变量，避免导出 shell 运行态。
     */
    private generatePosixShEnvironmentExportScript;
    /**
     * 生成别名导出脚本（bash / zsh）。
     */
    private generateAliasExportScript;
    /**
     * 生成工具配置脚本（PATH 导出等）的 mIY 函数的相关部分
     *
     */
    private generateToolConfigScript;
    /**
     * 验证 snapshot 是否可被目标 shell 静默 source。
     */
    private validateSnapshot;
    /**
     * 执行 snapshot 脚本
     */
    private executeSnapshotScript;
    /**
     * 注册退出时的清理回调
     * 与 Claude Code 使用 signal-exit 的 onExit 保持一致的行为
     */
    private registerCleanupCallback;
    /** The file is gone or no longer this service's; the listener goes with the last one. */
    private untrack;
}
