import { Subject } from 'rxjs';
import { ConsoleManager, ConsoleMessage, GlobalConsoleOptions } from './console-protocol';
export declare class ConsoleManagerImpl implements ConsoleManager {
    readonly messageSubject: Subject<ConsoleMessage>;
    private readonly originalConsole;
    private isIntercepted;
    private options;
    private paused;
    log(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
    debug(...args: unknown[]): void;
    info(...args: unknown[]): void;
    interceptGlobalConsole(options: GlobalConsoleOptions): void;
    restoreGlobalConsole(): void;
    pause(): void;
    resume(): void;
    isPaused(): boolean;
    private parseArgs;
    private output;
    /**
     * 解析输出模式
     */
    private resolveOutputMode;
    /**
     * 输出到 process.stdout/stderr
     */
    private outputToProcess;
    /**
     * 输出到原生 console
     */
    private outputToNativeConsole;
    /**
     * 输出到 UI 组件
     */
    private outputToUI;
}
