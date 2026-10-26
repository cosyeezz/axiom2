import { Event } from '@celljs/core';
import { SessionManager } from '../../vendor/cbc-core/node/index.js';
import { Logger } from '@genie/telemetry';
import { ShellExecutionHandle, ShellService } from '../shell';
import type { AnsiOutput } from '../shell/terminal-serializer';
import { CommandExecuteContext, CommandExecutor } from './command-protocol';
/**
 * 交互式 Shell 状态事件
 */
export interface InteractiveShellState {
    /** 是否处于交互式模式 */
    active: boolean;
    /** Shell 执行句柄，用于写入数据和获取屏幕内容 */
    handle?: ShellExecutionHandle;
    /** 正在执行的命令 */
    command?: string;
}
/**
 * 交互式 Shell 管理器
 * 用于在 UI 层和命令执行器之间共享交互式 shell 状态
 */
export declare const InteractiveShellManager: unique symbol;
export interface InteractiveShellManager {
    /** 当前交互式 shell 状态变化事件 */
    readonly onStateChange: Event<InteractiveShellState>;
    /** 获取当前状态 */
    getState(): InteractiveShellState;
    /** 设置交互式 shell 状态 */
    setState(state: InteractiveShellState): void;
    /** 向当前 shell 写入数据 */
    write(data: string): void;
    /** 获取当前屏幕内容（纯文本） */
    getScreen(): string;
    /** 获取当前屏幕内容（带颜色） */
    getColorScreen(): AnsiOutput;
    /** 调整终端大小 */
    resize(cols: number, rows: number): void;
    /** 终止当前进程 */
    kill(): Promise<void>;
}
export declare class InteractiveShellManagerImpl implements InteractiveShellManager {
    private state;
    private readonly _onStateChange;
    readonly onStateChange: Event<InteractiveShellState>;
    getState(): InteractiveShellState;
    setState(state: InteractiveShellState): void;
    write(data: string): void;
    getScreen(): string;
    getColorScreen(): AnsiOutput;
    resize(cols: number, rows: number): void;
    kill(): Promise<void>;
}
export declare class BashCommandExecutor implements CommandExecutor {
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    protected readonly shellService: ShellService;
    protected readonly sessionManager: SessionManager;
    protected readonly interactiveShellManager: InteractiveShellManager;
    protected readonly logger: Logger;
    execute(ctx: CommandExecuteContext): Promise<void>;
}
