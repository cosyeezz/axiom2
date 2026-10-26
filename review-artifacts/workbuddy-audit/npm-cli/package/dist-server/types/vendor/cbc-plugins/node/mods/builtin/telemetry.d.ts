import type { Register } from '../types';
/**
 * 内置 `telemetry` plugin —— 官方：「The engine does nothing with a mark: the
 * built-in plugins that hook the event queue the row.」
 *
 * `$.telemetry.log` / `$.telemetry.mark` 是 core 的 event call（`telemetry.log` /
 * `telemetry.mark`），本 plugin 挂在这两个事件上把条目排进队列；会话结束时把累计条数
 * 落到 `$.store`，跨会话可看出趋势。
 *
 * 坐在 builtin tier（`prepend → user → append → builtin → core`）：用户的 plugin 包在
 * 外层，可以观察、改写甚至拦下内置行为。
 */
/** 一条排进队列的埋点。 */
export interface TelemetryRow {
    readonly name: string;
    readonly at: number;
    readonly data?: Readonly<Record<string, unknown>>;
}
/** 内置 telemetry 的名字（`$.store` 按它分文件）。 */
export declare const BUILTIN_TELEMETRY_NAME = "cbc-telemetry";
/** 本进程排进队列的全部条目（`mark` 记作 `mark:<feature>`）。 */
export declare function builtinTelemetryRows(): readonly TelemetryRow[];
/** Tests only. */
export declare function resetBuiltinTelemetryForTests(): void;
/** 内置 telemetry 的 register。 */
export declare const registerBuiltinTelemetry: Register;
//# sourceMappingURL=telemetry.d.ts.map