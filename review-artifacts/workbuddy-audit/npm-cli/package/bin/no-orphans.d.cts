/** Install exit-time descendant cleanup, without tying this process to its parent. */
export function install(): boolean;
export function isEnabled(): boolean;
export function isDisabled(environment?: NodeJS.ProcessEnv): boolean;
export const DISABLE_ENV: string;
export const NO_ORPHANS_FLAG: '--no-orphans';
