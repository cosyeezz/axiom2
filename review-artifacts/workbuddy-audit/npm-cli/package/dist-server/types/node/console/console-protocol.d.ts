import { Subject } from 'rxjs';
export declare const ConsoleManager: unique symbol;
/**
 * Console 输出模式
 */
export declare enum ConsoleOutputMode {
    /** UI 模式：通过 Subject 发送到 UI 组件渲染（默认） */
    UI = "ui",
    /** 原生 Console 模式：使用原生 console.log/warn/error 等 */
    NATIVE = "native",
    /** Process Stream 模式：直接使用 process.stdout/stderr */
    PROCESS = "process",
    /** 静默模式：不输出任何内容 */
    SILENT = "silent"
}
/**
 * Console 输出选项
 */
export interface ConsoleOutputOptions {
    /**
     * 输出模式
     * - 'ui': 发送到 UI 组件（仅交互模式有效）
     * - 'native': 使用原生 console
     * - 'process': 使用 process.stdout/stderr
     *
     * 默认行为：
     * - 交互模式：使用 'ui'
     * - print 模式：使用 'process'
     */
    mode?: ConsoleOutputMode;
    /**
     * 消息展示时长（毫秒），仅在 UI 模式下有效
     * @default 5000
     */
    displayDuration?: number;
    /**
     * Custom color override for UI mode (CSS color name or hex).
     * Takes precedence over type-based color in ConsoleMessageBox.
     */
    color?: string;
}
/**
 * Console 消息
 */
export interface ConsoleMessage {
    type: 'log' | 'warn' | 'error' | 'debug' | 'info';
    content: string;
    displayDuration: number;
    /** Optional custom color override (CSS color name or hex). Takes precedence over type-based color. */
    color?: string;
}
export interface GlobalConsoleOptions {
    isDebug: boolean;
    isPrint: boolean;
}
/**
 * Console 管理器
 * 统一管理所有 console 输出，根据运行模式自动选择输出方式
 */
export interface ConsoleManager {
    /**
     * 日志输出
     */
    log(message: string, options?: ConsoleOutputOptions): void;
    log(...args: unknown[]): void;
    /**
     * 警告输出
     */
    warn(message: string, options?: ConsoleOutputOptions): void;
    warn(...args: unknown[]): void;
    /**
     * 错误输出
     */
    error(message: string, options?: ConsoleOutputOptions): void;
    error(...args: unknown[]): void;
    /**
     * 调试输出
     */
    debug(message: string, options?: ConsoleOutputOptions): void;
    debug(...args: unknown[]): void;
    /**
     * 信息输出
     */
    info(message: string, options?: ConsoleOutputOptions): void;
    info(...args: unknown[]): void;
    /**
     * 消息流，供 UI 组件订阅
     */
    readonly messageSubject: Subject<ConsoleMessage>;
    /**
     * 接管全局 console
     */
    interceptGlobalConsole(params: GlobalConsoleOptions): void;
    /**
     * 恢复全局 console
     */
    restoreGlobalConsole(): void;
    /**
     * 暂停 console 输出
     * 暂停后所有 console 消息将被静默丢弃
     */
    pause(): void;
    /**
     * 恢复 console 输出
     * 恢复后 console 消息将正常打印
     */
    resume(): void;
    /**
     * 检查当前是否处于暂停状态
     */
    isPaused(): boolean;
}
