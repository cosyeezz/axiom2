import { type ProductCustomConfigurationV1, type ProductCustomMarketplaceItemV1 } from './product-custom-config-schema';
/**
 * 规范化后的 `updates` 字段。
 *
 * - `{ disabled: true }`：禁用形态（首版默认）。省略 `updates` 时也补齐为这个值。
 * - `{ disabled?: false; checkVersion: {...}; download: {...}; manualOnly?: boolean }`：
 *   客户源形态。检查/下载 URL 必须共享同一 host + 目录前缀（由 releases service 消费）。
 *
 * 联合类型用可辨识字段是 `disabled` 常量位。
 */
export type NormalizedProductCustomUpdates = {
    disabled: true;
} | {
    disabled?: false;
    checkVersion: {
        url: string;
        intervalSeconds?: number;
    };
    download: {
        url: string;
    };
    manualOnly?: boolean;
};
/** 规范化后的完整配置：updates / builtInMarketplaces 必填。 */
export interface NormalizedProductCustomConfigurationV1 {
    branding?: ProductCustomConfigurationV1['branding'];
    endpoint?: string;
    stagingEndpoint?: string;
    updates: NormalizedProductCustomUpdates;
    links?: ProductCustomConfigurationV1['links'];
    telemetry?: ProductCustomConfigurationV1['telemetry'];
    dataLayout?: ProductCustomConfigurationV1['dataLayout'];
    builtInMarketplaces: Record<string, ProductCustomMarketplaceItemV1>;
    /**
     * 客户文件里**显式出现**过的"意图型"字段。
     *
     * 必须记录，因为规范化会补默认值：`{}`（官方内嵌空模板）与
     * `{"updates":{"disabled":true}}` / `{"builtInMarketplaces":{}}` 规范化后**同形**，
     * 只靠内容无法区分「客户显式要求」与「空模板补出来的默认」。
     *
     * 缺失（旧快照 / 测试桩）按"未知"处理，退回纯内容判定，保持既有行为。
     */
    explicit?: {
        readonly updates?: boolean;
        readonly builtInMarketplaces?: boolean;
    };
}
export interface ProductCustomConfigErrorOptions {
    filePath: string;
    field: string;
    expected: string;
    actual: string;
}
/** 配置非法错误，message 按统一格式输出。 */
export declare class ProductCustomConfigError extends Error {
    readonly filePath: string;
    readonly field: string;
    readonly expected: string;
    readonly actual: string;
    constructor(options: ProductCustomConfigErrorOptions);
}
/** 对已解析的配置对象做 Schema 校验，非法时抛 ProductCustomConfigError。 */
export declare function validateProductCustomConfig(input: unknown, filePath: string): ProductCustomConfigurationV1;
/**
 * 规范化配置：
 * - updates 省略 → 补 `{ disabled: true }`
 * - builtInMarketplaces 省略/`{}` → `{}`
 * - endpoint 去末尾 `/`
 */
export declare function normalizeProductCustomConfig(config: ProductCustomConfigurationV1, filePath?: string): NormalizedProductCustomConfigurationV1;
/**
 * 判定一份规范化 snapshot 是否「实际上未定制」。
 *
 * 触发场景：`customization.json` 只写了 `{}`（goreleaser 官方 Bun 二进制内嵌的空模板、
 * 部署占位等）。经 normalizeProductCustomConfig 会得到
 * `{ updates: { disabled: true }, builtInMarketplaces: {} }` —— 非 undefined，
 * 但没有任何客户实际填写的字段。
 *
 * 官方 CLI 若把它当定制版处理，会静默关闭自动更新 / 清空官方市场 / 丢失 `cbc` 别名，
 * 因此消费方（CustomProductConfigProvider / resolveProductIdentity /
 * resolveProductCapabilities）必须在入口显式挡掉。
 *
 * 「有没有填字段」按**内容**判定而非「键是否存在」：schema 的 branding / links /
 * telemetry / dataLayout 都是 `.strict()` 但无 `required` / `minProperties` 的对象，
 * `{"branding":{}}`、`{"dataLayout":{"configDir":{}}}` 这类键在值为空的写法同样能通过
 * 校验，若只判 `!== undefined` 就会把它们当定制版，触发上面同一串静默劣化。
 *
 * ⚠️ 本判定只回答"有没有**品牌类**定制内容"。客户**显式**要求禁用更新 / 清空市场
 * （`hasExplicitUpdatesDisabled` / `hasExplicitBuiltInMarketplaces`）不属于此，需按字段
 * 另行判定 —— 否则 `{"updates":{"disabled":true}}` 这类最小配置会被当成 `{}` 静默丢弃。
 */
export declare function isEffectivelyEmptyCustomConfig(custom: NormalizedProductCustomConfigurationV1): boolean;
/**
 * 客户是否**显式**表达了「禁用自动更新」——含"只写 updates"的最小配置形态。
 *
 * `{}` 空模板规范化后同样是 `{ disabled: true }`，但其 `explicit.updates === false`，
 * 因此不会被误判为"客户要求禁更新"。消费方（capabilities）据此只关更新能力位，
 * 不连带关闭 Daemon / settings endpoint 覆盖（客户没提这些）。
 */
export declare function hasExplicitUpdatesDisabled(custom: NormalizedProductCustomConfigurationV1): boolean;
/**
 * 客户是否**显式**给出了 builtInMarketplaces（`{}` 也代表"清空官方市场"的明确意图）。
 * 只影响市场投影，不连带影响更新能力位。
 */
export declare function hasExplicitBuiltInMarketplaces(custom: NormalizedProductCustomConfigurationV1): boolean;
/**
 * 该配置是否值得投影进 product provider 链（CustomProductConfigProvider 的入口判定）。
 *
 * 真实定制内容 → 是；此外，**仅**显式禁用更新 / 仅显式清空市场的最小配置也算 ——
 * 否则客户的显式隔离意图会被静默丢弃（被当成官方版继续走官方更新通道 / 官方市场）。
 */
export declare function hasProjectableCustomConfig(custom: NormalizedProductCustomConfigurationV1): boolean;
/** 解析 JSON 文本 → Schema 校验 → 规范化。 */
export declare function parseProductCustomConfig(json: string, filePath: string): NormalizedProductCustomConfigurationV1;
/**
 * 从文件系统加载 customization.json。
 * 文件不存在返回 undefined（官方版本行为完全不变）；存在但非法抛 ProductCustomConfigError。
 */
export declare function loadProductCustomConfig(configPath: string): NormalizedProductCustomConfigurationV1 | undefined;
