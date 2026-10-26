import { type MultitaskSessionRef } from './types';
export interface EnterMultitaskResult {
    ok: boolean;
    already: boolean;
    /** 切换后是否处于协调器。enter 永远 true（失败除外）；toggle 可 false。 */
    on: boolean;
    message: string;
}
export declare const MINIMAL_MULTITASK_BLOCKED = "Multitask is not available in Minimal. Switch to Standard, PTC, or Creator first.";
/** 会话内 `/multitask` 立刻盖章。非空白也可进。 */
export declare function enterMultitaskFromSlash(session: MultitaskSessionRef | null | undefined): EnterMultitaskResult;
export declare function leaveMultitaskFromSlash(session: MultitaskSessionRef | null | undefined): EnterMultitaskResult;
/** `/multitask` 开关：已在协调器则关掉 overlay，站立 mode 不动。 */
export declare function toggleMultitaskFromSlash(session: MultitaskSessionRef | null | undefined): EnterMultitaskResult;
/** 委托 overlay：与 multitask 互斥（盖章时清掉 multitask）。极简也可进。 */
export declare function enterDelegateFromSlash(session: MultitaskSessionRef | null | undefined): EnterMultitaskResult;
export declare function leaveDelegateFromSlash(session: MultitaskSessionRef | null | undefined): EnterMultitaskResult;
/** `/delegate` 开关。 */
export declare function toggleDelegateFromSlash(session: MultitaskSessionRef | null | undefined): EnterMultitaskResult;
