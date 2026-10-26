import type { Model } from '@openai/agents-core';
/**
 * 记下一轮的开始。`turn.start` 的 `text` 是这轮的输入，而运行态进入 PREPARING
 * 时输入还没写进历史（prompt.submit 的折叠在 run 里跑），所以 `start` 推迟到这轮
 * 第一次模型请求前（或没有请求、直接收尾前）才发。
 */
export declare function beginModsTurn(sessionId: string, turnId: string, start?: () => Promise<unknown>): void;
/** 发出这一轮尚未发出的 `turn.start`；已发过则等它那一次。 */
export declare function startModsTurn(sessionId: string): Promise<unknown>;
/**
 * 收掉这一轮。返回它的 `turn.start`（若发过）；没发过说明这轮从未请求模型 ——
 * 本地斜杠命令（`/flightdeck layout …`）也会走一轮运行态，但官方语义里它们
 * 「run at once, with no Claude turn」，不该有 turn 事件。
 */
export declare function endModsTurn(sessionId: string): Promise<unknown> | undefined;
/** What the turn that just ended cost (its requests summed, the last model); taken once. */
export declare function takeModsTurnUsage(sessionId: string): StepUsage | undefined;
export interface ModsTurnStepContext {
    readonly session: {
        readonly id: string;
        readonly meta?: {
            readonly parentSessionId?: string;
        };
    };
    readonly model: string;
    /** The host's Model for another id, for `next({ ...e, model })`; its own requests raise no `turn.step`. */
    readonly resolve?: (model: string) => Promise<Model>;
}
interface StepUsage {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
    model: string;
}
/** 给每次模型请求套上 `turn.step`。 */
export declare function withModsTurnStep(model: Model, context: ModsTurnStepContext): Model;
export {};
