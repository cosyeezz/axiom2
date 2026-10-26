import { homedir, platform } from 'node:os';
import { FileSystem } from '@genie/runtime';
import { InstallEnvironment } from './install-protocol';
export declare class InstallEnvironmentImpl implements InstallEnvironment {
    readonly fs: FileSystem;
    platform: typeof platform;
    arch: () => NodeJS.Architecture;
    homedir: typeof homedir;
    versiondir(app: string): string;
    bindir(app: string): string;
    findCmd(cmd: string): Promise<string | undefined>;
}
