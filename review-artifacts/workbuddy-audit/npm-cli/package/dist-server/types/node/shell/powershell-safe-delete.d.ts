/**
 * PowerShell safe-delete 预置脚本。
 *
 * 目标：在 PowerShell 路径下统一把 `rm` / `del` / `erase` / `ri` / `rmdir` /
 * `unlink` 路由到回收站删除逻辑，并对失败场景保持 fail-closed（拒绝真删）。
 *
 * 说明：
 * - 优先调用 genie-trash native helper（若存在）。
 * - binary 不可用时回退到 Microsoft.VisualBasic 回收站 API。
 * - 仅在当前 PowerShell 进程内生效；通过全局标记避免重复定义。
 */
export declare const POWERSHELL_SAFE_DELETE_PRELUDE: string;
export declare function wrapPowerShellCommandWithSafeDelete(command: string, options?: {
    enabled?: boolean;
    inlineEnv?: Record<string, string | undefined>;
}): string;
