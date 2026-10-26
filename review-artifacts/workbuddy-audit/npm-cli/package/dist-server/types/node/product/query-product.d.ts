import { AsyncLocalStorage } from 'node:async_hooks';
import { type Agent, type LanguageModel, type ProductConfiguration } from '@genie/product';
/** One query owns its configuration; asynchronous child work inherits the same value. */
export interface QueryProduct {
    readonly configuration: ProductConfiguration;
    /** Only an explicit per-query endpoint overrides the deployment URL. */
    readonly overridesEndpoint: boolean;
    readonly agents: ReadonlyMap<string, Agent>;
    readonly models: ReadonlyMap<string, LanguageModel>;
    readonly defaultAgentName: string;
}
export declare const queryProductScope: AsyncLocalStorage<QueryProduct | undefined>;
export declare function resolveQueryProduct(): QueryProduct | undefined;
/**
 * 本次执行的网络环境（`CODEBUDDY_INTERNET_ENVIRONMENT` 的取值）。
 *
 * 查询带 Product 时以它的 networkEnvironment 为准：同一进程里的会话可能属于不同产品配置，
 * 进程 env 只代表宿主启动时的那一份。Product 未声明即未设置，不再回落 env。
 * 没有查询 Product 时（CLI 子进程、查询之外）读 env。
 */
export declare function readQueryNetworkEnvironment(env?: NodeJS.ProcessEnv): string | undefined;
/** Resolve one execution snapshot without retaining or mutating either input. */
export declare function captureQueryProduct(product: Partial<ProductConfiguration>, baseline?: ProductConfiguration): QueryProduct;
