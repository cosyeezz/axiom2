import type { Logger } from '@celljs/core';
import { type ModifyBackupExcludedPathOptions } from '../bash-sandbox/backup-policy';
import type { ISandboxCLILifecycle } from '../sandbox-cli/sandbox-cli-lifecycle-protocol';
import type { SandboxTurnConfig as ISandboxTurnConfig } from '../sandbox-cli/sandbox-turn-config';
import type { SandboxCenterIpcClient as ISandboxCenterIpcClient } from '../sensitive-content/sandbox-center-ipc-client-protocol';
import type { SessionManager } from '../session';
export interface BrokeredCreatedFileBackupParams {
    targetPath: string;
    sessionId?: string;
    excludedPathOptions?: ModifyBackupExcludedPathOptions;
    logPhase: string;
    sandboxTurnConfig?: ISandboxTurnConfig;
    sandboxLifecycle?: ISandboxCLILifecycle;
    sandboxCenterClient?: ISandboxCenterIpcClient;
    sessionManager?: SessionManager;
    logger?: Logger;
}
/**
 * 在新建文件落盘后向 Sandbox 登记 `reason=a`。
 *
 * 新建文件不需要内容快照；Sandbox 写入空快照标记、路径与所属 commit，整轮回退时据此删除文件。
 * 调用方必须已经确认该路径在写入前不存在，本函数只负责写后校验和 IPC 登记。
 */
export declare function registerCreatedRegularFileForRollback(params: BrokeredCreatedFileBackupParams): Promise<void>;
