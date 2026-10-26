import { Logger } from '@celljs/core';
import { type ISandboxCLILifecycle } from '../sandbox-cli/sandbox-cli-lifecycle-protocol';
import { SandboxTurnConfig } from '../sandbox-cli/sandbox-turn-config';
import { SandboxCenterIpcClient } from '../sensitive-content/sandbox-center-ipc-client-protocol';
/** 媒体产物只接文件备份，不参与路径和网络权限裁决。 */
export declare class MediaFileWriter {
    protected readonly turnConfig?: SandboxTurnConfig;
    protected readonly lifecycle?: ISandboxCLILifecycle;
    protected readonly centerClient?: SandboxCenterIpcClient;
    protected readonly logger: Logger;
    writeFile(filePath: string, data: Buffer): Promise<void>;
}
