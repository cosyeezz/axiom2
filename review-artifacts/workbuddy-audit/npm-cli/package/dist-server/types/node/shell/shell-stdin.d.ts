import type { ShellType } from './shell-utils';
/** 保留 PTY 输出；无人提供输入的工具调用只关闭命令组的标准输入。显式管道/重定向仍可覆盖它。 */
export declare function applyShellStdinMode(command: string, shell: ShellType, stdinMode?: 'ignore'): string;
