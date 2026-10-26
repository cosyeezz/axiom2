import { type NormalizedProductCustomConfigurationV1, ProductCustomConfigError } from './product-custom-config-validator';
/**
 * 按交付形态计算 customization.json 路径（纯函数，便于测试）：
 * - npm 包 / Node 开发：`rootPath/customization.json`（包根目录，独立文件）；
 * - Bun 单文件：`rootPath/customization.json`（rootPath = `$bunfs/root`，配置在编译期嵌入）。
 * 两种形态定位统一为 `rootPath/customization.json`。
 */
export declare function resolveCustomConfigPathForForm(rootPath: string): string;
/** 按交付形态定位 customization.json。 */
export declare function locateProductCustomConfigPath(): string;
/**
 * 启动期加载 customization.json。
 *
 * - 文件不存在：返回 undefined，官方行为不变；
 * - 配置非法：抛 ProductCustomConfigError（调用方负责打印并退出）；
 * - 配置合法：返回规范化结果。
 */
export declare function loadProductCustomConfigOnce(): NormalizedProductCustomConfigurationV1 | undefined;
/** 幂等加载并缓存；只应在进程启动早期调用一次。 */
export declare function bootstrapProductCustomConfig(): NormalizedProductCustomConfigurationV1 | undefined;
/** 测试辅助：重置缓存与加载状态，避免单测间串扰。 */
export declare function resetProductCustomConfigBootstrap(): void;
/** 返回已加载的外置配置（未加载或不存在返回 undefined）。 */
export declare function getBootstrapProductCustomConfig(): NormalizedProductCustomConfigurationV1 | undefined;
/**
 * 启动期入口：加载并校验 customization.json；异常时打印错误并 process.exit(1)。
 * 由 side-effect 入口 product-custom-config-bootstrap-entry.ts 在模块加载时调用。
 *
 * 全部异常在此统一格式化 & exit，保持"进入 side-effect 入口即失守" 的单一出口：
 * - `ProductCustomConfigError`：按统一结构化错误打印；
 * - 其它未预期异常（fs 权限 / OOM / 依赖破损 等）：打印完整 stack 供排查；
 * 两类都在**任何网络请求前**终止进程，避免带病启动。
 */
export declare function bootstrapProductCustomConfigOrExit(): NormalizedProductCustomConfigurationV1 | undefined;
export type { NormalizedProductCustomConfigurationV1 };
export { ProductCustomConfigError };
