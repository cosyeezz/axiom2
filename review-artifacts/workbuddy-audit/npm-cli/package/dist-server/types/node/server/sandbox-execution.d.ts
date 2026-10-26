import type { SubagentLifecycleSnapshot } from '../../vendor/cbc-core/node/index.js';
import { SandboxExecution } from '../sandbox/execution-scope';
export declare function sessionSandboxExecution(sessionId: string): SandboxExecution;
/** An idle account switch replaces owned resources before the next query. */
export declare function configureSandboxExecution(sessionId: string, policy: Parameters<SandboxExecution['configure']>[0]): Promise<SandboxExecution>;
export declare function trackSandboxSubagent(sessionId: string, task: SubagentLifecycleSnapshot): void;
/** The execution a session already has; closing work must not create one. */
export declare function existingSandboxExecution(sessionId: string): SandboxExecution | undefined;
export declare function hasSandboxWork(sessionId: string): boolean;
export declare function closeSandboxExecution(sessionId: string): Promise<void>;
