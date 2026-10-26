import { type QueryProduct } from '../product/query-product';
import type { QueryOptions } from './types';
/** Called after startup, before entering a run or mounting its session. */
export declare function resolveExecutionProduct(product: QueryOptions['product']): Promise<QueryProduct | undefined>;
