import { HookInput } from '../../vendor/cbc-core/node/index.js';
import { HookExecutionOptions, HookExecutionResult } from '../../vendor/cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import { type ChildProcess } from 'child_process';
import { DebugService } from '../debug';
import { HookExecutor } from './hook-protocol';
export declare function getPowerShellHookShellConfig(): {
    executable: string;
    argsPrefix: string[];
};
export declare function buildHookSpawnOptions(env: NodeJS.ProcessEnv, windows?: boolean, session?: HookInput['session'], baseEnv?: NodeJS.ProcessEnv): {
    stdio: ['pipe', 'pipe', 'pipe'];
    env: NodeJS.ProcessEnv;
    windowsHide?: true;
};
export declare function tryBuildDirectPowerShellHookCommand(command: string, env: NodeJS.ProcessEnv): {
    executable: string;
    args: string[];
} | undefined;
/**
 * Implementation of HookExecutor that executes shell commands
 * and handles JSON I/O via stdin/stdout
 */
export declare class HookExecutorImpl implements HookExecutor {
    protected readonly logger: Logger;
    protected readonly debugService: DebugService;
    protected getEnvironment(): NodeJS.ProcessEnv;
    /** Track the physical child, including hooks that return async:true early. */
    protected onSpawn(child: ChildProcess): void;
    /**
     * Execute a hook command with input data
     *
     * @param command - Shell command to execute
     * @param input - Input data to pass via stdin as JSON
     * @param options - Execution options (timeout, env vars)
     * @returns Execution result with output and status
     */
    execute(command: string, inputWithSession: HookInput, options?: HookExecutionOptions): Promise<HookExecutionResult>;
    private deriveHookStatus;
    /**
     * Parse hook output and determine result
     *
     * Exit code semantics (Claude Code compatible):
     * - 0: Success
     * - 2: Blocking error (stderr fed to Claude)
     * - Other: Non-blocking error (shown to user, continue execution)
     */
    private parseHookOutput;
}
