/**
 * Loopback（`127.0.0.1` 上的 `/internal/*`）请求的体积边界。
 *
 * ## 为什么需要显式配置
 *
 * loopback 客户端走 celljs `RestOperationsFactory.create()` → `axios@0.26.1`
 * （由 `@celljs/http` 钉死）。该版本 http 适配器只在 `maxBodyLength > -1` 时才
 * 把值透传给 `follow-redirects`，**没有 else 分支**：
 *
 * ```js
 * // axios@0.26.1 lib/adapters/http.js:233
 * if (config.maxBodyLength > -1) {
 *     options.maxBodyLength = config.maxBodyLength;
 * }
 * ```
 *
 * axios 默认 `maxBodyLength = -1`，于是什么都不透传，`follow-redirects` 退回自带默认值
 * `10 * 1024 * 1024`（10 MiB，见 follow-redirects@1.16.0 index.js:517），超出即在本地抛
 * `ERR_FR_MAX_BODY_LENGTH_EXCEEDED` / "Request body larger than maxBodyLength limit"——
 * **一个字节都没发出去**。
 *
 * 而同一跳的服务端是刻意配成 100mb 的（`genie*.yaml` 的 `cell.web.body.limit`，
 * 注释写明"本地 ACP 最多承载 50 MiB 图片；base64 后约 67 MiB"）。客户端那 10 MiB
 * 从来不是有意设置的上限，纯粹是上述漏传造成的意外，且比服务端严格一个量级：
 * 带几张截图的一轮对话（实测 18–19 MB）会在模型被调用之前就确定性失败。
 *
 * ## 取 Infinity 而不是某个具体数值
 *
 * 体积裁决点只能有一个，否则客户端和 `cell.web.body.limit` 两个数字要长期手工对齐。
 * 客户端不再自行设限，超限一律由服务端裁决并返回真实的 HTTP 413 —— 那是一个带响应体的
 * 正常响应，可以被归类、可以拿到可读文案，而不是本地抛出的内部传输字符串。
 *
 * 同款修复与原因分析另见 `node/model/model-provider.ts` 的模型请求配置。
 */
export declare const LOOPBACK_BODY_LIMIT_CONFIG: {
    readonly maxBodyLength: number;
    readonly maxContentLength: number;
};
/**
 * 把"请求体超限"翻译成用户可行动的文案。
 *
 * 覆盖两种形态：
 *   1. 客户端本地拒收（`ERR_FR_MAX_BODY_LENGTH_EXCEEDED`）——修掉
 *      {@link LOOPBACK_BODY_LIMIT_CONFIG} 未覆盖的路径时的兜底；
 *   2. 服务端按 `cell.web.body.limit` 拒收，返回 HTTP 413。
 *
 * 刻意不在文案里写死具体上限：上限由 `genie*.yaml` 单点定义，复述一份就要长期手工对齐。
 * 只报实际体积 + 该怎么办。
 *
 * @returns 命中时返回可展示文案；不是体积问题则返回 `undefined`，交回原有错误处理。
 */
export declare function describeOversizedPayloadError(error: unknown): string | undefined;
