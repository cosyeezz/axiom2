import { type Sandbox } from './sandbox';
export interface LocalSandboxOptions {
    /** Working directory. Defaults to `process.cwd()`. */
    cwd?: string;
    /**
     * Env vars layered on top of the allowlist for `exec()`. Set a key to
     * undefined to drop a default; pass `{ ...process.env }` to inherit
     * everything (exposes host secrets to sandbox consumers).
     */
    env?: Record<string, string | undefined>;
}
export declare function createLocalSandbox(options?: LocalSandboxOptions): Sandbox;
