type NodePtyModule = typeof import('@lydell/node-pty');
/** worker 失败、命令未启动即结束时上报的退出码。 */
export declare const WINDOWS_PTY_WORKER_FAILED_EXIT_CODE = -1;
/** 本进程是否已观测到 ConPTY 输出 worker 失败；为 true 时调用方应回落 ChildProcess。 */
export declare function isWindowsPtyWorkerBroken(): boolean;
/** 仅供单测复位进程级标记。 */
export declare function resetWindowsPtyWorkerBrokenForTest(): void;
/**
 * Resolves the PTY implementation installed by an embedding application.
 *
 * Agent Harness uses this seam to expose its Bun Terminal adapter from the
 * single SFE executable. Ordinary Agent CLI processes do not install the
 * symbol and therefore retain their existing platform/runtime selection.
 */
export declare function loadEmbeddedNodePty(): Promise<NodePtyModule | undefined>;
/**
 * Loads the platform PTY implementation.
 *
 * Keep the ordinary fallback a literal import: Agent CLI's own Bun standalone
 * builds discover and embed the platform package from this edge. Agent Harness
 * externalizes that specifier while compiling its SFE and installs a
 * process-local loader for the Bun Terminal adapter embedded in that same SFE.
 */
export declare function loadNodePty(): Promise<NodePtyModule>;
export {};
