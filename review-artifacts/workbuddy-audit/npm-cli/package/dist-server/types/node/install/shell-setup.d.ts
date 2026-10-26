import { type InstallEnvironment, ShellSetup } from './install-protocol';
export declare class PosixSetup implements ShellSetup {
    get name(): string;
    exists(): boolean;
    rcfiles(env: InstallEnvironment): string[];
    rcsToUpdate(env: InstallEnvironment): string[];
    envScript(env: InstallEnvironment, bindir: string): string;
    setup(env: InstallEnvironment, bindir: string): Promise<void>;
}
export declare class BashSetup implements ShellSetup {
    get name(): string;
    exists(env: InstallEnvironment): Promise<boolean>;
    rcfiles(env: InstallEnvironment): string[];
    rcsToUpdate(env: InstallEnvironment): Promise<string[]>;
    envScript(env: InstallEnvironment, bindir: string): string;
    setup(env: InstallEnvironment, bindir: string): Promise<void>;
}
export declare class ZshSetup implements ShellSetup {
    get name(): string;
    exists(env: InstallEnvironment): Promise<boolean>;
    private getZshDotDir;
    rcfiles(env: InstallEnvironment): Promise<string[]>;
    rcsToUpdate(env: InstallEnvironment): Promise<string[]>;
    envScript(env: InstallEnvironment, bindir: string): string;
    setup(env: InstallEnvironment, bindir: string): Promise<void>;
}
export declare class FishSetup implements ShellSetup {
    get name(): string;
    exists(env: InstallEnvironment): Promise<boolean>;
    envScript(env: InstallEnvironment, bindir: string): string;
    setup(env: InstallEnvironment, bindir: string): Promise<void>;
}
export declare function filterAsync<T>(arr: T[], pred: (v: T) => Promise<boolean>): Promise<T[]>;
export declare function shellEnvContains(shellName: string): boolean;
export declare function portablePath(env: InstallEnvironment, path: string): string;
export declare function getCurrentShellRcFiles(env: InstallEnvironment): Promise<string[]>;
