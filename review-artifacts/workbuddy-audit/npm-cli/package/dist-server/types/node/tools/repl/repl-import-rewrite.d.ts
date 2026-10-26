/**
 * 预处理用户 REPL 代码,在包进 async-IIFE 之前用 acorn 做两趟变换:
 *   1. 动态 import(x) → __replImport(x)(bridge resolver 全局;Bun 的 vm.SyntheticModule 有 bug,只能源码改写)。
 *   2. 顶层声明提升 + 末尾表达式 → return:
 *      - const/let/var/function/class 改写成对持久 vm.Context 的 global 赋值,让变量跨 cell 存活
 *        (kernel/cell 模型的关键——否则 IIFE 一结束声明就没了,`const x = 5` 下个 cell 就读不到);
 *      - 最后一条裸表达式前缀 `return`,所以 `return` 和末尾表达式两种写法都能拿到结果。
 *
 * 变换后由 manager 包进 (async () => { ... })()。顶层 await/return 落进这个 async 函数;顶层声明已经被改成
 * 对 global 的 bare 赋值——非严格模式下 bare 赋值写到 vm.Context 的 global,于是跨 cell 持久。
 */
/** import() → __replImport() + 顶层声明提升到 global + 末尾表达式 → return。解析失败则原样返回(交给 vm.Script 报错)。
 *
 * async：内部走 acorn/acorn-walk lazy chunk（standby 不 parse）；本函数是 hot path
 * 上唯一使用者。caller `repl-worker-manager.executeCell` 在 async 上下文，加 await 即可。
 */
export declare function transformReplCode(source: string, checkBashEscapes?: boolean): Promise<string>;
