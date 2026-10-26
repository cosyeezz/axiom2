export type EnvironmentParentReadPolicy = 'processBaseline' | 'contextual';
export type EnvironmentChildProjectionPolicy = 'contextual' | 'boundaryOwned' | 'forced';
export interface EnvironmentKeyRule {
    readonly parentRead: EnvironmentParentReadPolicy;
    readonly child: EnvironmentChildProjectionPolicy;
}
export declare const EnvironmentKeyPolicy: unique symbol;
export interface EnvironmentKeyPolicy {
    resolve(key: string): EnvironmentKeyRule;
}
/** 登记 safe-delete node shim 的 NODE_OPTIONS 注入值（仅限第一方 shim 产出方调用）。 */
export declare function registerNodeOptionsShimValue(value: string): void;
/** 仅当 candidate 是已登记的 shim 值时原样放行，否则强制清空为 ''。 */
export declare function resolveWhitelistedNodeOptions(candidate: string | undefined): string;
/** 测试专用：清空 NODE_OPTIONS 白名单登记表。 */
export declare function __resetNodeOptionsShimRegistryForTest(): void;
export declare class EnvironmentKeyPolicyImpl implements EnvironmentKeyPolicy {
    resolve(key: string): EnvironmentKeyRule;
}
