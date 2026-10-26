import type { EventLoopLagSampler } from './event-loop-lag-sampler';
export declare function setCliLoopLagSampler(sampler: EventLoopLagSampler | undefined): void;
/** 最近 windowMs 内 CLI 自身的最大调度延迟，格式化为 `cliLagMaxMs=<n|na>`。 */
export declare function formatCliLoopLagWithin(windowMs: number): string;
