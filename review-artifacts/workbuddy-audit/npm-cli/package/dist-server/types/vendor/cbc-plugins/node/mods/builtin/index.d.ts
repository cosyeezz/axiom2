import type { RegisteredMod } from '../types';
export * from './sec-default';
export * from './telemetry';
/**
 * 宿主自带的 mod，坐在 `builtin` tier。
 *
 * tier 顺序是 `prepend → user → append → builtin → core`，builtin 在 user 之内 ——
 * 用户装的 mod 包在外层，可以观察、改写甚至拦掉内置行为。内置的是**缺省值**，
 * 不是不可绕过的沙箱；真正不可绕过的边界在宿主自己的权限系统里。
 *
 * 顺序也有意义：`telemetry` 排在 `sec-default` 前面，这样后者若要记录自己拦了
 * 什么，`$.telemetry` 已经 seat 好了。
 */
export declare function builtinMods(): readonly RegisteredMod[];
//# sourceMappingURL=index.d.ts.map