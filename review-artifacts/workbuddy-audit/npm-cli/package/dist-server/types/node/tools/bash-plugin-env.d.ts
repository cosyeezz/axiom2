import type { PluginManager } from '../../vendor/cbc-plugins/node/index.js';
/**
 * 把额外的 bin 目录前置到 PATH，根据目标 shell 自动选择路径风格和分隔符。
 *
 * 为什么需要 shell 感知：
 * - Git Bash（Windows 上最常见的 bash）对 PATH 里的 Windows 路径（`C:\...`）
 *   处理有坑：npm cmd-shim 在 Git Bash 下用 `$0` 推导 basedir 时，若 PATH 里
 *   是反斜杠形式，cygpath 转换结果会错位到 MSYS 安装根目录下。所以 bash/zsh/sh
 *   在 Windows 下应该用 POSIX 路径（`/c/Users/...`）+ `:` 分隔。
 * - PowerShell / cmd 只认 Windows 路径（`C:\Users\...`）+ `;` 分隔。
 * - 非 Windows 平台各路径风格本就统一，直接用 `:` 即可。
 */
export declare function buildPluginPathEnv(extraPaths: string[]): string;
/**
 * 前后台执行与命令来源校验必须使用同一套插件 PATH 组装规则。`env` 是这次调用的
 * 合并环境，目录变量从它读。
 */
export declare function getBashPluginEnv(pluginManager?: Pick<PluginManager, 'getPluginBinPaths'>, env?: Readonly<Record<string, string | undefined>>): Promise<Record<string, string> | undefined>;
