/**
 * `local()` — Sandbox factory binding directly to the host (vendored surface
 * of flue v2's node/local). The default sandbox for server sessions that do
 * not inject one: the file face is host fs, the rich shell capabilities are
 * served by the kernel shell stack.
 */
import { type LocalSandboxOptions } from './local-env';
import type { SandboxFactory } from './sandbox';
export type { LocalSandboxOptions } from './local-env';
export declare function local(options?: LocalSandboxOptions): SandboxFactory;
