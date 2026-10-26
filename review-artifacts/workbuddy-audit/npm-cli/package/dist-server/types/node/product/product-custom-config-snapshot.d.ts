/**
 * customization.json 运行时快照（无依赖，打破循环依赖）。
 *
 * 存在原因：`product-custom-config-bootstrap.ts` 需要 `PathUtils.getRootPathSync()`
 * 定位配置文件，而 `PathUtils` 又需要读取定制目录名（getHomeDir/getProjectHomeDir）。
 * 若 PathUtils 直接 import bootstrap，会形成循环依赖。此模块只保存值、无任何依赖，
 * bootstrap 加载完成后写入快照，PathUtils / memory-protocol / system-service 等
 * 静态工具类从这里读取。
 */
import type { NormalizedProductCustomConfigurationV1 } from './product-custom-config-validator';
/** 写入快照（由 bootstrap 在启动早期调用）。 */
export declare function setProductCustomConfigSnapshot(config: NormalizedProductCustomConfigurationV1 | undefined): void;
/** 读取快照；无外置配置或尚未加载返回 undefined（官方行为不变）。 */
export declare function getProductCustomConfigSnapshot(): NormalizedProductCustomConfigurationV1 | undefined;
