import { type Session } from '../../vendor/cbc-core/node/index.js';
/**
 * 把发起本次请求的客户端遥测信息（`session.telemetryClientInfo`）直接展开写入 event payload。
 *
 * 优先级：上报点显式非空值 > 客户端值 > 进程级 processor 兜底。显式写 `''` / `undefined`
 * 视为未提供，仍由客户端值补齐。写入发生在 `report()` 之前，进程级 processor 均为
 * "空值才兜底"，因此结果不依赖 processor 执行顺序，也不存在 processor 超时后临时字段
 * 泄漏进上报的问题。
 *
 * - 无session 或 session 未携带客户端信息（普通 CLI）→ 原样返回 payload，processor 走进程级兜底。
 * - 仅写入白名单内的非空字符串字段（stream-json 入口未做校验，这里统一过滤）。
 * - **就地写入并返回同一对象**：调用点 `report(code, attachTelemetryClientCarrier(payload, session))`
 *   即可，不改变原有 report 调用形态（await / options / 是否 modelEventService 均不受影响）。
 *
 * 供`TelemetryServiceImpl` 及包外上报点（friction / credit-refund / mcp 等持有 session 者）复用。
 */
export declare function attachTelemetryClientCarrier<T extends object>(payload: T, session: Session | undefined): T;
