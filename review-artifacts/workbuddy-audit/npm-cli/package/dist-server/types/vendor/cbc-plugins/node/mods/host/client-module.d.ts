/** 编译产物的上限：远端面每次挂载都要收这一份，没必要放任巨型 bundle 过线。 */
export declare const CLIENT_MODULE_MAX_CODE: number;
export interface ClientModuleCode {
    /** CJS 代码：执行时提供 `module` / `exports` / `require` 三个形参。 */
    readonly code: string;
}
/**
 * 解析并编译一个 plugin 的 surface module。
 *
 * @param root plugin 根目录（`RegisteredMod.root`）
 * @param module `ClientProps.module` 原样
 * @throws 路径不合法、越界、不是普通文件、编译失败或产物超限
 */
export declare function compileClientModule(root: string, module: string): Promise<ClientModuleCode>;
/** 官方给 `Client` 的 props 与 `surface.post` 数据定的上限。 */
export declare const CLIENT_DATA_BOUNDS: {
    readonly values: 20000;
    readonly depth: 32;
    readonly chars: 100000;
};
/**
 * 纯数据且在官方上限内？—— `ui.message` 的 `data` 来自远端面里跑的代码，
 * 进 hook 链前必须先挡一道（官方：`data` is input to validate, not a fact）。
 */
export declare function isBoundedClientData(value: unknown): boolean;
/** 测试用：清空编译缓存。 */
export declare function clearClientModuleCache(): void;
//# sourceMappingURL=client-module.d.ts.map