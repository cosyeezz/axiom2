import { Logger } from '@celljs/core';
import { ConsoleManager } from '../console';
import type { InstallOptions, InstallResult } from './install-protocol';
import { InstallService } from './install-protocol';
export declare class InstallController {
    protected readonly logger: Logger;
    protected readonly installer: InstallService;
    protected readonly consoleManager: ConsoleManager;
    install(options: InstallOptions): Promise<InstallResult>;
    private displayResult;
    private displaySuccess;
    private displayPathInstructions;
    private displayProgress;
    private displayError;
}
