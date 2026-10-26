/**
 * cbc-mods 的入口开关。
 *
 * ## 默认开 —— 可用 env 显式关闭
 *
 * 与官方 Claude Code 对齐：v2.1.287 起 mods 默认开启，不再需要 early access 的
 * `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`。cbc 同样默认装配 `--plugin-dir` 与已装
 * plugin 里的 function hooks。
 *
 * 显式关（任一 alias 显式关即整体关）：
 * - `CBC_ENABLE_FUNCTION_HOOKS=0` / `false` / `off` / `no`（大小写不敏感、允许前后空格）
 * - `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=0` 同上（兼容别名）
 *
 * 未设、空串、truthy 或未识别值（如 `maybe`）都按默认开处理。
 */
export declare const FUNCTION_HOOKS_ENV_VAR = "CBC_ENABLE_FUNCTION_HOOKS";
export declare const CLAUDE_COMPAT_ENV_VAR = "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS";
/** 关闭 mod 隔离沙箱的 env 变量名（默认开，仅用于逃生）。 */
export declare const MODS_ISOLATE_ENV_VAR = "CBC_MODS_ISOLATE";
/**
 * 判断当前环境是否启用 cbc-mods function hooks。
 *
 * 语义：任一 alias 显式关闭 → 关；其余 → 开。
 */
export declare function isFunctionHooksEnabled(env?: NodeJS.ProcessEnv): boolean;
/**
 * mod 是否走隔离沙箱执行（`isolated-import.ts` 的加固 realm）。
 *
 * 默认开 —— 隔离是安全默认，只有显式 `CBC_MODS_ISOLATE=0/false/off/no` 才关
 * （逃生阀，供确需直接摸 Node 内建的 mod 临时降级）。未识别值按「不关」处理，仍然隔离。
 */
export declare function isModIsolationEnabled(env?: NodeJS.ProcessEnv): boolean;
/** 关闭 mod 出网（`$.http.fetch`）的 env 变量名。 */
export declare const MODS_ALLOW_HTTP_ENV_VAR = "CBC_MODS_ALLOW_HTTP";
/** 关闭 mod 起子进程（`$.process.run`）的 env 变量名。 */
export declare const MODS_ALLOW_PROCESS_ENV_VAR = "CBC_MODS_ALLOW_PROCESS";
/**
 * CLI 宿主是否给 mod 开 `$.http.fetch`。
 *
 * 与官方 Claude Code 对齐：CLI 下默认可用，管理员可显式关（`CBC_MODS_ALLOW_HTTP=0/false/off/no`）。
 * 这是宿主表态，core 层 `HostBindings.allowHttp` 仍默认关，不受本开关影响。
 */
export declare function isModHttpAllowed(env?: NodeJS.ProcessEnv): boolean;
/** CLI 宿主是否给 mod 开 `$.process.run`；`CBC_MODS_ALLOW_PROCESS=0/false/off/no` 显式关。 */
export declare function isModProcessAllowed(env?: NodeJS.ProcessEnv): boolean;
//# sourceMappingURL=enable-flag.d.ts.map