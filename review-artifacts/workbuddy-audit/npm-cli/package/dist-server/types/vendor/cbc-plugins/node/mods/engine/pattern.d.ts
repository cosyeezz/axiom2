import type { EventInput, EventName, Matcher, Pattern } from '../types';
/**
 * 判断一个 `on()` pattern 是否命中某个具名事件。
 *
 * 支持三种形态（对齐官方 `Pattern = EventName | Glob | Negation`）：
 * - 具名：`'tool.call'` —— 精确相等
 * - Glob：`'*'` 全部；`'classic.*'` / `'ui.*'` —— namespace 前缀
 * - Negation：`'!tool.call'` / `'!ui.*'` —— 取反（命中被排除的以外全部）
 *
 * @param pattern on() 的第一参
 * @param event 正在分发的具名事件
 */
export declare function patternMatches(pattern: Pattern, event: EventName): boolean;
/**
 * matcher 整体是否命中事件入参。matcher 未指定的字段视为通配。
 *
 * @param matcher on() 的第二参；undefined 表示无 matcher（永远命中）
 * @param input 事件入参
 */
export declare function matcherApplies(matcher: Matcher | undefined, input: EventInput): boolean;
//# sourceMappingURL=pattern.d.ts.map