/**
 * Small async concurrency helpers for IO-heavy startup paths.
 */
export { mapWithConcurrency } from '../../vendor/cbc-shared/node/index.js';
export declare function getPositiveIntegerEnv(name: string, fallback: number): number;
export declare const DEFAULT_FS_CONCURRENCY = 32;
export declare const DEFAULT_PLUGIN_COMPONENT_CONCURRENCY = 32;
