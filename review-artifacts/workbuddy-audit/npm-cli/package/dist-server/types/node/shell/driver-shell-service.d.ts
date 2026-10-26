import type { ShellExecuteParams, ShellExecutionHandle, ShellService } from './shell-protocol';
export declare const DriverShellService: unique symbol;
export declare class DriverShellServiceImpl implements ShellService {
    private activeHandles;
    execute(params: ShellExecuteParams): Promise<ShellExecutionHandle>;
    disposeAll(): Promise<void>;
    getActiveHandleCount(): number;
}
