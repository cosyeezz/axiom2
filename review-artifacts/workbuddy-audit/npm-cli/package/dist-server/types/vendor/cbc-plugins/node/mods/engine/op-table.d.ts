import type { EventName } from '../types';
/**
 * `$` 上每个 noun 的方法 → op 事件名 + 入参打包方式。
 *
 * 对齐官方 `OpEventOf`（54 个）。每一项声明：
 * - `event`：分发的事件名。绝大多数是 op 事件（`OpEventName`），但少数走
 *   middleware 事件（`ui.resolve` 就是这样：mod 写 `const table = await
 *   $.ui.resolve(e)`，但 `ui.resolve` 本身是 `EngineEventName` 中的一员）。
 * - `pack`：把方法实参打成事件入参对象
 *
 * 这张表是 `$` 的唯一真源：`buildOpSurface()` 据此生成所有方法，
 * 每个方法都先 `dispatch(event, packed)`，hook 可 `{ value }` 短路 /
 * `{ deny }` 拒绝，否则落 host 实现。
 */
export interface OpSpec {
    readonly event: EventName;
    readonly pack: (...args: readonly unknown[]) => Record<string, unknown>;
}
/** noun → method → OpSpec。 */
export declare const OP_TABLE: Readonly<Record<string, Readonly<Record<string, OpSpec>>>>;
/**
 * `$` 上直接分发 middleware 事件（而非 op 事件）的方法。
 *
 * 这些调用的结果是事件本身的结果形状（不是 `{ value }`），
 * 对齐官方 `EventCalls`。
 */
export declare const EVENT_CALL_TABLE: Readonly<Record<string, Readonly<Record<string, EventName>>>>;
/** 全部 noun 名（含只走 event call 的 skill / attribution）。 */
export declare const ALL_NOUNS: readonly string[];
/**
 * op 事件 → 它对应的 `$` 调用写法（`$.fs.read` 这种）。
 *
 * 给 core 用：一个宿主没实现的能力必须回**指名道姓**的拒绝，而不是静默
 * `undefined` —— 后者会让 mod 把「没实现」当成「值就是空」继续跑，错误被推迟到
 * 很远的地方才炸。反查表让那句话能自己写出是哪个能力。
 */
export declare const OP_CALL_NAMES: ReadonlyMap<string, string>;
//# sourceMappingURL=op-table.d.ts.map