/**
 * Serial aibot_respond_msg per callback req_id.
 *
 * Official SDK: send one frame, wait for errcode, then send the next.
 * Same stream.id coalesces to the latest full replace. finish=true seals that
 * stream.id only — a new stream.id on the same req_id is a new chat bubble.
 */
import { type WecomBotWsFrame, type WecomBotWsResponse } from './wecom-bot-types';
export interface WecomRespondJob {
    reqId: string;
    streamId: string;
    content: string;
    finish: boolean;
}
export declare class WecomRespondQueue {
    private readonly send;
    private readonly timeoutMs;
    private readonly logger?;
    private seq;
    private readonly inFlight;
    private readonly queues;
    /** Late ack after timeout must not complete the next in-flight frame. */
    private readonly staleAck;
    /** finish=true seals one stream.id, not the whole req_id. */
    private readonly sealed;
    constructor(send: (frame: WecomBotWsFrame) => void, timeoutMs?: number, logger?: {
        warn(msg: string): void;
    } | undefined);
    enqueue(job: WecomRespondJob): Promise<void>;
    handleAck(reqId: string, response: WecomBotWsResponse): boolean;
    dispose(): void;
    private pump;
}
