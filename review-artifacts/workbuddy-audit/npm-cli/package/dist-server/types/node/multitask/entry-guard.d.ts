import { type MultitaskProcessGuardOpts } from './types';
export declare class MultitaskProcessNotAllowedError extends Error {
    readonly reason: 'print' | 'non-tty' | 'stream-json' | 'disable-background' | 'acp';
    constructor(reason: MultitaskProcessNotAllowedError['reason'], detail: string);
}
/** `--multitask` 归一成 `--agent multitask`。显式 flag 优先于其它 --agent。 */
export declare function normalizeMultitaskCliAgent(opts: {
    agent?: unknown;
    multitask?: unknown;
}): string | undefined;
/** agent 名为 multitask 时检查。失败 throw，不 process.exit。 */
export declare function assertMultitaskProcessAllowed(opts?: MultitaskProcessGuardOpts): void;
