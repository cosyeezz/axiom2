/**
 * 编码族真·惰性装载：iconv-lite + jschardet 合计 ~769 KB 主 chunk 源码。
 *
 * **历史陷阱**：原实现用 `require('iconv-lite')` 期望 lazy——但 rspack 把
 * `require(literal)` 识别为静态依赖，仍会把整包打进主 chunk（standby 期常驻
 * ~10-15 MB heap，`__webpack_modules__[id]` wrapper closure 一族）。真·lazy 必须
 * 走 dynamic `import()`——rspack ESM 出图（chunkFormat=module）会拆成
 * `lazy-lite-wb/<name>.[chunkhash].mjs`，Node 22 只在首次 `import()` 时才 parse。
 *
 * ## 契约：同步 accessor + 显式 preload
 *
 * 使用姿势：**先 `await preloadIconv()` / `preloadJschardet()`，之后同步
 * `getIconv()` / `getJschardet()` 拿模块**。这保留了 stream `on('data')` /
 * shell buffer 回调这类同步热路径的形态，只需在 execute() 入口预加载一次。
 *
 * 未 preload 就调 getter 会 fail-loud（抛错）——这是刻意设计：如果静默回退
 * `require()` 或同步 `import()`，就会绕过 lazy chunk、退化回主 chunk 常驻。
 * 抛错让调用点问题暴露到 CI/E2E，而不是线上悄悄回归内存。
 *
 * ## Standby 期不加载的证据
 *
 * standby = `runPrewarmStandby` 内 `waitForActivation()` 阻塞，无 tool.execute /
 * shell exec / read-tool，编码路径完全触不到。iconv-lite + jschardet 到 activate
 * 后 tool 首次执行才装载，standby heap 摘除 ~10-15 MB。
 */
type IconvLite = typeof import('iconv-lite');
type Jschardet = typeof import('jschardet');
/**
 * 触发 iconv-lite lazy chunk 加载。幂等；重复调只会 await 同一个 promise。
 * caller 应在需要用 `getIconv()` 的作用域**入口**（tool.execute / shell 命令启动）
 * await 一次；深层同步回调（stream on('data') 等）随后可以裸调 getIconv()。
 */
export declare function preloadIconv(): Promise<IconvLite>;
/**
 * 同步取 iconv-lite。**必须**先 `await preloadIconv()`，否则 fail-loud。
 * 不做 sync require 回退：静默回退会让整个 lazy 优化退化回主 chunk 常驻。
 */
export declare function getIconv(): IconvLite;
export declare function preloadJschardet(): Promise<Jschardet>;
export declare function getJschardet(): Jschardet;
/**
 * 一次预热编码族（iconv + jschardet）。适合 tool.execute 入口一句话拉起两个包。
 */
export declare function preloadEncoding(): Promise<void>;
export {};
