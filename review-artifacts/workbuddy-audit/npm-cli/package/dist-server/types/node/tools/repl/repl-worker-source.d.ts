/**
 * REPL worker source string for `new Worker(src, { eval: true })`.
 *
 * The worker is authored as TypeScript in `./worker/repl-worker.ts` and bundled by
 * `scripts/gen-repl-worker-source.mjs` (vite) into `./repl-worker-source.generated.ts`.
 * This module only re-exports the generated constant so the import path stays stable.
 *
 * Why a string constant rather than a worker file:
 *   - agent-cli ships as a Bun single-file executable; there is no worker file to point at.
 *   - A string is opaque to rspack, so the worker's own `require` calls are never rewritten.
 *   - An inline worker inside the SFE has no node_modules, so the worker uses Node builtins
 *     only; acorn's import() rewrite runs on the main thread before the code is sent in.
 *
 * Protocol and sandbox rules are documented at the top of `./worker/repl-worker.ts`.
 */
export { REPL_WORKER_SOURCE } from './repl-worker-source.generated';
