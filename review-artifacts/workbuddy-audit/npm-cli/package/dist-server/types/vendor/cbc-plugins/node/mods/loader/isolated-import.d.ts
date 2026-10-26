/**
 * 在隔离 realm 里执行一份 CJS bundle，取回它的 `module.exports`。
 *
 * @param code 转译后的 CJS 单文件产物
 * @param filename 供栈帧显示（一般是 register 入口的绝对路径）
 * @param modName mod 名（错误信息用）
 */
export declare function runModuleInSandbox(code: string, filename: string, modName: string, log?: (...args: unknown[]) => void): unknown;
/**
 * 隔离通道的模块加载器 —— 与 `defaultImporter` 同签名（`ModuleImporter`），可直接
 * 作为 `LoadOptions.importModule` 传入。
 *
 * Bun.Transpiler / jiti → CJS 单文件（内容寻址磁盘缓存，flavor `cjs-vm`，与 ESM 产物分键）
 * → 加固 realm 执行 → 取回 `module.exports`。
 *
 * @param entry register 模块的绝对路径
 * @param root mod 的 root。给出时源码读取/解析被限定在该 root 内（含 symlink realpath），
 *   图外或 Node/第三方包导入在执行前就被拒绝；缺省时保留旧的无约束编译（仅供无 root 的直接调用）。
 * @param env 环境（决定缓存根目录；测试可指向临时目录）
 */
export declare function importModuleIsolated(entry: string, root?: string, env?: NodeJS.ProcessEnv): Promise<unknown>;
//# sourceMappingURL=isolated-import.d.ts.map