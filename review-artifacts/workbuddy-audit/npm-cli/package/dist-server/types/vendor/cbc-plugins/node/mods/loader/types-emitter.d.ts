import type { LoadedMod } from './load-mod';
/**
 * mods 的对外 TS 契约 —— 生产、命名空间与落盘位置。
 *
 * ## 命名空间
 *
 * cbc 以 `codebuddy-code` 为**主模块名**，并把 `claude-code` 作为**兼容别名**
 * 一起声明。于是：
 * - cbc 生态：`import type { On } from 'codebuddy-code'`
 * - 未经改动的官方 mod：`import type { On } from 'claude-code'` 同样成立
 *
 * 两个模块名指向同一套声明（别名文件 `export * from` 主文件），所以不会出现
 * 「同名类型两份实例」的问题。
 *
 * ## 落盘位置
 *
 * 与官方 `/plugin-types` 的布局对齐（官方写 `.claude/types/`）：
 *
 * ```
 * <cwd>/.codebuddy/types/
 * ├── codebuddy-code.d.ts               # 引擎 API 声明（主）
 * ├── claude-code.d.ts                  # 兼容别名，re-export 主文件
 * ├── codebuddy-code-plugins.d.ts       # 已启用 plugin 契约的索引
 * └── codebuddy-code-plugins/
 *     └── <plugin>.d.ts                 # 每个 plugin 的契约副本
 * ```
 *
 * ## 怎么生产
 *
 * `emitPluginTypes()` 是唯一入口（宿主把它挂到 `/plugin-types` 斜杠命令或
 * `codebuddy plugin types` 子命令上）：
 * 1. 写引擎声明（来源是本包 `mods/types/` 的编译产物 `.d.ts`，见 `engineDeclarations`）
 * 2. 逐个拷贝各 plugin 的 `types` 契约到 `codebuddy-code-plugins/<plugin>.d.ts`
 * 3. 生成索引 `codebuddy-code-plugins.d.ts`（`/// <reference path="…" />` 汇总）
 */
/** 主模块名。 */
export declare const PRIMARY_MODULE = "codebuddy-code";
/** 兼容模块名（让官方 mod 原样通过类型检查）。 */
export declare const COMPAT_MODULE = "claude-code";
/** 产出根目录（相对工作目录）。 */
export declare const TYPES_DIR: string;
/** 兼容读取的老目录（Claude Code 的位置）。 */
export declare const COMPAT_TYPES_DIR: string;
/** 各产物文件名。 */
export declare const TYPE_FILES: {
    readonly engine: "codebuddy-code.d.ts";
    readonly engineCompat: "claude-code.d.ts";
    readonly pluginsIndex: "codebuddy-code-plugins.d.ts";
    readonly pluginsDir: "codebuddy-code-plugins";
    readonly mcp: "codebuddy-code-mcp.d.ts";
};
/** `emitPluginTypes` 的入参。 */
export interface EmitOptions {
    /** 工作目录（产物落到 `<cwd>/.codebuddy/types/`）。 */
    readonly cwd: string;
    /**
     * 引擎 API 的声明正文。
     *
     * 宿主传入本包 `mods/types` 的编译产物（`lib/node/mods/types/events.d.ts`
     * 或其打平版本）。这里不自己跑 tsc —— 保持本函数纯 IO，便于测试。
     */
    readonly engineDeclarations: string;
    /** 已启用的 mod（用其 `manifest.types` 找契约文件）。 */
    readonly mods?: readonly LoadedMod[];
    /** MCP 工具输入声明（可选）。 */
    readonly mcpDeclarations?: string;
}
/** 一次生产的结果。 */
export interface EmitResult {
    /** 写出的文件绝对路径。 */
    readonly written: readonly string[];
    /** 被跳过的 plugin 契约与原因。 */
    readonly skipped: readonly {
        readonly plugin: string;
        readonly reason: string;
    }[];
}
/** 契约校验失败的原因。 */
export interface ContractProblem {
    readonly line?: number;
    readonly reason: string;
}
/**
 * 校验一个 plugin 的类型契约是否「自包含、纯类型」。
 *
 * 规则与官方 `claude plugin validate` 对齐：
 * - 不含 import / export-from / require / `/// <reference>`
 * - 不含会运行的代码（`class` / `const` / `enum` / `function` / `let` / `var`）
 * - 不含隐藏或改变阅读顺序的字符
 *
 * @param source 契约文件正文
 * @returns 问题列表；空数组表示通过
 */
export declare function validateContract(source: string): readonly ContractProblem[];
/**
 * 生成 mods 的对外 TS 契约。
 *
 * @param options 工作目录 / 引擎声明 / 已启用 mod
 * @returns 写出的文件与跳过项
 */
export declare function emitPluginTypes(options: EmitOptions): Promise<EmitResult>;
/** 两个候选 types 目录（`.codebuddy/types` 优先，`.claude/types` 兼容）。 */
export declare function typesDirCandidates(cwd: string): readonly string[];
/** 给 mod 作者用的 tsconfig 片段（把产物纳入类型检查）。 */
export declare function tsconfigHint(): string;
//# sourceMappingURL=types-emitter.d.ts.map