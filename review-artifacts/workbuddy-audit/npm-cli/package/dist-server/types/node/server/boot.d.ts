import 'reflect-metadata';
import type { ProductConfiguration } from '@genie/product';
import { HttpProxyProvider } from '../http/http-proxy-protocol';
declare module '@celljs/core/lib/common/container/dynamic-container' {
    function createContainer(): Promise<import('@celljs/core').Container>;
}
/**
 * 每次生命周期内惰性且幂等。首个 start()/verb 驱动（ensureStarted 收口）。
 * boot 失败即出队：best-effort 释放半装配态后清缓存，下一次调用真重试——
 * rejected promise 常驻会把一次瞬时失败固化成进程终身拒绝（lamp 毒 pod
 * 判例：boot 崩一次后每个会话都撞 already-started，pod 成毒丸）。
 */
export declare function ensureBoot(product?: ProductConfiguration, httpProxy?: HttpProxyProvider): Promise<void>;
/**
 * stop() 收尾：Application.stop() → unbindAllAsync → Effect.dispose。
 * 成功后可由新的显式 start() 构造全新容器；失败仍尝试全部阶段，但拒绝
 * 再次 boot，避免旧 finalizer 与新实例共享进程级适配器。
 */
export declare function releaseContainer(): Promise<void>;
