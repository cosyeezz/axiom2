/**
 * W3C trace-id 工具（独立模块以便单测）。
 */
/**
 * 校验 W3C trace-id：32 位小写 hex，且非全零。
 * 用于校验 Renderer 透传的 traceId，非法时退回 OTel 自生成。
 */
export declare function isValidW3CTraceId(value: string | undefined): value is string;
/** 校验 W3C span-id：16 位小写 hex，且非全零。 */
export declare function isValidW3CSpanId(value: string | undefined): value is string;
/**
 * 解析 W3C `traceparent` header 字符串 `00-<traceId>-<spanId>-<flags>`。
 * 版本、字段格式或数值任一非法时返回 undefined，调用方按无 parent 处理。
 */
export declare function parseW3CTraceparent(traceparent: string | undefined): {
    traceId: string;
    spanId: string;
} | undefined;
/** Formats the active producer span as a W3C traceparent. */
export declare function formatW3CTraceparent(traceId: string | undefined, spanId: string | undefined, sampled: string | number | boolean | undefined): string | undefined;
//# sourceMappingURL=trace-id-utils.d.ts.map