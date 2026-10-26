import { EventProcessContext, EventProcessor } from '@genie/telemetry';
/**
 * processor 顺序不保证；客户端值有值即覆盖，进程级 processor 只兜底空值。
 * 载体是内部字段，用后删除，避免泄漏进最终上报 payload。
 */
export declare class TelemetryClientInfoEventProcessor implements EventProcessor {
    process({ event }: EventProcessContext): Promise<void>;
}
