/**
 * 按绝对路径做**真正的** ESM 动态 import。
 *
 * ## 两个 magic comment 都是必需的，不是装饰
 *
 * agent-cli 的发布产物是 rspack 打出的 CJS bundle。打包器默认会接管它**能看见**
 * 的每一个 `import(x)`：在 CJS 输出里退化成自己的 `require(x)`。而 mod 的入口是
 * 运行时才知道的绝对路径，落到 CJS `require` 上必然失败 —— 实测发布产物报
 * `Cannot find module 'file:///…/register.ts'`：CJS 既不认 `file://` URL，也不认
 * `.ts` 扩展名，更不会经过我们注册的 ESM resolve 钩子。
 *
 * `webpackIgnore` 让 rspack/webpack 原样保留这行 `import()`，交给 Node 的 ESM
 * 加载器；`@vite-ignore` 让 vitest/Vite 别去静态分析一个运行时才成形的 specifier。
 *
 * 源码直跑（vitest / raw node）时没有打包器介入，所以缺了注释的坑**只在打包产物
 * 里暴露** —— 这也是为什么这条路径必须用真实产物验证，单测全绿不能说明它通。
 */
export declare function importByPath(absPath: string): Promise<unknown>;
/**
 * 把一个本地 specifier 解析成实际存在的 TS 文件路径。
 *
 * @param p 已按 parent 解析出的绝对路径（可能无扩展名 / 是目录 / 带 .js 后缀）
 * @returns 命中的文件绝对路径；没有则 undefined
 */
export declare function resolveTsPath(p: string): string | undefined;
/** 本进程是否跑在 Bun 上。 */
export declare function isBun(): boolean;
/**
 * runtime 是否自己就能吃下官方 mod 的写法（TS + 目录 import + `.js`→`.ts` + JSX）。
 *
 * 目前只有 Bun 满足。实测 Bun 1.4 原样加载全部四个官方 mod。
 */
export declare function hasNativeTypeScriptSupport(): boolean;
/**
 * 本进程是否具备 Node 内建通道 —— **两个条件都要**：
 *
 * 1. `module.registerHooks()`（Node 22.15+）—— 补 Bun 式模块解析
 * 2. type stripping 开启 —— 擦类型
 *
 * 光有其一没用。真实存在的缺口是 **Node 22.15–22.17**：`registerHooks` 已经有了，
 * 但 type stripping 要等 22.18 才默认开。那个区间若只按 `registerHooks` 判断，
 * 每个 mod 都得先尝试失败一次才回退，白付一次开销（实测：strip 关闭时缓存里
 * 出现 2 个产物而不是 1 个，说明连非 JSX 的 mod 也绕了一圈）。提前判掉更干净。
 */
export declare function isNodeTypeScriptAvailable(): boolean;
/**
 * 在「只对 `root` 之下生效」的钩子作用域内跑一段加载逻辑。
 *
 * 并发安全：多个 mod 同时加载时共用一次注册，引用计数归零才 `deregister()`。
 * 因此钩子存在的时间被压到最短，宿主此后的模块解析不再经过它。
 *
 * @param root 允许被补解析的目录（mod 的 root）
 * @param body 加载逻辑
 */
export declare function withModResolveScope<T>(root: string, body: () => Promise<T>): Promise<T>;
/** 该错误是否说明「这个 mod 需要真转译器」。 */
export declare function needsTranspiler(error: unknown): boolean;
/**
 * 通道一 / 二：runtime 原生，或 Node 内建 type stripping + 作用域化 resolve 钩子。
 *
 * @param entry register 模块的绝对路径
 * @param root 该 mod 的 root（钩子白名单；缺省用 entry 所在目录）
 */
export declare function importWithNodeTypeStripping(entry: string, root?: string): Promise<unknown>;
//# sourceMappingURL=ts-runtime.d.ts.map