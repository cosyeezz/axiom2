import type { Server, StartOptions } from './types';
export declare function start(options?: StartOptions): Promise<Server>;
/** Start barrier for verbs: auto-start with defaults when start() was not called. */
export declare function ensureStarted(): Promise<StartOptions>;
/** The drain behavior is registered by the sessions domain to avoid a module cycle. */
export declare function registerStopHandler(handler: () => Promise<void>): void;
/**
 * stop 排空路径的 options 快照——绕过 ensureStarted 的 stopped 门（doStop 先置
 * 终态再排空，handler 若走 ensureStarted 会被自己拒掉——e2e 实锤的自爆序）。
 * 仅 stop handler 使用；verbs 一律走 ensureStarted。
 */
export declare function startedOptionsForShutdown(): StartOptions;
