export declare abstract class ProcessUtils {
    /**
     * 执行命令并返回 Promise
     */
    static runCommand(cmd: string, args: string[], input?: string, env?: Record<string, string>): Promise<boolean>;
    /**
     * 执行命令并返回输出结果。失败（非零退出 / 超时 / 命令不存在）统一吞掉，返回
     * `{ code, stdout }`（stdout 可能为空）。可选 `timeout`：超时由 nano-spawn 以
     * SIGTERM 杀子进程并 reject，于是这里归一为 `stdout:''`。
     */
    static runCommandWithOutput(cmd: string, args: string[], options?: {
        timeout?: number;
        signal?: AbortSignal;
    }): Promise<{
        code: number | null;
        stdout: string;
    }>;
    /**
     * Windows 平台将文本复制到剪贴板
     */
    static copyToClipboardWindows(text: string): Promise<boolean>;
}
