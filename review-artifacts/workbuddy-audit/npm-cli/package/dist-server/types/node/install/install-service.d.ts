import { ConsoleManager } from '../console/console-protocol';
import { type Installation } from '../utils/installation-utils';
import type { InstallOptions, InstallProgressEvent, InstallResult } from './install-protocol';
import { InstallEnvironment, InstallService, ReleasesService, ShellSetup } from './install-protocol';
export declare class InstallServiceImpl implements InstallService {
    protected readonly env: InstallEnvironment;
    protected readonly releases: ReleasesService;
    protected readonly shellSetups: ShellSetup[];
    protected readonly consoleManager: ConsoleManager;
    private readonly onProgressEmitter;
    readonly onProgress: import("@celljs/core").Event<InstallProgressEvent>;
    private pathWasAutoSetup;
    get binary(): string;
    get binaryExe(): string;
    get productName(): string;
    get packageName(): string;
    install(options?: InstallOptions): Promise<InstallResult>;
    currentInstallation(): Promise<Installation>;
    private fetchVersion;
    private downloadAndExtract;
    private replaceCurrentNativeBinary;
    private installBins;
    private handleInstallError;
    private getErrorMessage;
    private getDisplayLocation;
    private trySetupPath;
    private setupPathUnix;
    private setupPathWindows;
    private getPathStatus;
    private isBinaryInPath;
    private getRefreshCommands;
    private getSetupCommands;
    /**
     * Remove old versions to save disk space, keeping the most recent ones
     */
    private pruneOldVersions;
}
