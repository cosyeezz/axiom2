import type { StateAddress, StateRead, StateSetResult } from '../types';
/**
 * 官方 `$.state` 的宿主侧存储 —— 会话内的具名值，每个值带版本号。
 *
 * - 值由宿主持有，mod 代码热重载后照样读得到（模块变量做不到）。
 * - 任何 plugin 都能读；只有 `plugin` 字段等于自己的值才能写。
 * - `ifVersion` 做 compare-and-set：`update()` 在 plugin 侧据此重试。
 * - 存的是 JSON 副本：值不能带函数 / 环，与 `$.store.set` 同规矩。
 * - 每次写成功回调 `onChange`，宿主据此重画读过它的界面（官方：nobody calling
 *   `$.ui.invalidate`）。
 */
export declare class ModStateStore {
    private readonly onChange?;
    private readonly values;
    constructor(onChange?: ((address: StateAddress) => void) | undefined);
    get(address: StateAddress): StateRead;
    set(owner: string, address: StateAddress, value: unknown, ifVersion?: number): StateSetResult;
    /** `/clear`、`/resume`：所有值回到初值（官方：resets every `$.state` value to its default）。 */
    clear(): void;
}
/** 校验并取出地址：`plugin` / `key` 必须是字符串，`id` 可选。 */
export declare function stateAddressOf(input: unknown): StateAddress;
//# sourceMappingURL=state-store.d.ts.map