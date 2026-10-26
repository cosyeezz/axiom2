import { HooksError } from '../engine/hooks-error';
import type { HttpInit, HttpResponse } from '../types';
/**
 * `$.http.fetch` 无法发出请求时的拒绝。core 把它转成 `{ deny }`，mod 侧得到一个
 * 可 catch 的异常。
 */
export declare class HttpFetchRefusal extends HooksError {
}
/**
 * 宿主代 mod 发一次 HTTP(S) 请求，读完 body 后给出 `{ status, ok, headers, text }`。
 *
 * 只取官方 `HttpInit` 里的 `method / headers / body / socketPath`，不把 mod 给的其它
 * 字段原样塞给 `fetch`。`auth` 句柄来自 `$.session.authorize()`，本宿主不签发，
 * 带了就明确拒绝，免得 mod 以为凭据已经带上。
 */
export declare function fetchForMod(rawUrl: string, init: HttpInit | undefined, signal?: AbortSignal): Promise<HttpResponse>;
//# sourceMappingURL=http-fetch.d.ts.map