import { type Logger } from '@celljs/core';
import type { SessionManager } from '../../vendor/cbc-core/node/index.js';
import { type CreatedPathOrigin } from '@genie/sandbox-cli/created-file-rollback';
import type { ModifyBackupExcludedPathOptions } from '../bash-sandbox/backup-policy';
import type { ISandboxCLILifecycle } from '../sandbox-cli/sandbox-cli-lifecycle-protocol';
import type { SandboxTurnConfig as ISandboxTurnConfig } from '../sandbox-cli/sandbox-turn-config';
import type { SandboxCenterIpcClient as ISandboxCenterIpcClient } from '../sensitive-content/sandbox-center-ipc-client-protocol';
export type { CreatedPathAutoGrantEffect } from '@genie/sandbox-cli/created-file-rollback';
export interface CreatedPathAutoGrantDeps {
    logger?: Logger;
    sandboxLifecycle?: ISandboxCLILifecycle;
    sandboxCenterClient?: ISandboxCenterIpcClient;
    sessionManager?: SessionManager;
    sandboxTurnConfig?: ISandboxTurnConfig;
    modifyBackupExcludedPathOptions?: ModifyBackupExcludedPathOptions;
}
interface CreatedPathParams {
    sessionId?: string;
    targetPath: string;
    createdPathOrigin?: CreatedPathOrigin;
    deps: CreatedPathAutoGrantDeps;
}
export declare function createCreatedPathAutoGrantEffect(params: CreatedPathParams & {
    enabled: boolean;
}): Promise<import("@genie/sandbox-cli/created-file-rollback").CreatedPathAutoGrantEffect | undefined>;
export declare function addAutoGrantRuleForCompletedWrite(params: CreatedPathParams & {
    existedBefore: boolean;
}): Promise<void>;
export declare function addAutoGrantRuleForCreatedPath(params: CreatedPathParams & {
    isDirectory: boolean;
}): Promise<void>;
