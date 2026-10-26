/**
 * plugin manifest 目录名 —— cbc 优先自有命名，同时**兼容识别** Claude Code 的。
 *
 * 顺序即优先级，与普通插件扫描共用 codebuddy、workbuddy、claude 的约定。
 */
export declare const MANIFEST_DIRS: string[];
export type ManifestDir = (typeof MANIFEST_DIRS)[number];
/** manifest 文件名（各实现一致）。 */
export declare const MANIFEST_FILE = "plugin.json";
/** hooks manifest 相对 plugin root 的路径（各实现一致）。 */
export declare const HOOKS_MANIFEST: readonly ['hooks', 'hooks.json'];
/** 一次探测的结果。 */
export interface ManifestLocation {
    /** 命中的目录名。 */
    readonly dir: ManifestDir;
    /** `<root>/<dir>/plugin.json` 的绝对路径。 */
    readonly path: string;
    /** 已读到的原文。 */
    readonly text: string;
}
/**
 * 在 plugin root 下按 PLUGINS_METADATA_DIRS 的优先级寻找 manifest。
 *
 * 这样一来，`anthropics/claude-code/mods/*` 这类**未经改动的官方 mod 目录**
 * 可以直接被 cbc 加载（它们只有 `.claude-plugin`），而 cbc 自有生态可以用
 * `.codebuddy-plugin` 且不与 Claude 争抢同一个目录名。
 *
 * @param root plugin 根目录
 * @returns 命中的位置；候选目录都没有则 undefined
 */
export declare function findManifest(root: string, readText?: (path: string) => Promise<string>, joinPath?: (...paths: string[]) => string): Promise<ManifestLocation | undefined>;
/** 供诊断用：列出候选路径。 */
export declare function manifestCandidates(root: string): readonly string[];
//# sourceMappingURL=manifest-dir.d.ts.map