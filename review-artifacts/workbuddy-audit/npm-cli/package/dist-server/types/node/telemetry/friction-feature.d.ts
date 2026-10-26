import { ProductFeature } from '@genie/product';
type ProductFeatures = Partial<Record<ProductFeature, boolean>> | undefined;
/**
 * 情绪摩擦分析默认关闭，只有产品配置显式下发 true 时才启用。
 */
export declare function isChatPromptFrictionAnalysisEnabled(productFeatures: ProductFeatures): boolean;
export {};
