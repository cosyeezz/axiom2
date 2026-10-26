/**
 * 官方市场名称保护 - 四层防御
 *
 * 防止第三方冒充官方市场：
 * 1. 白名单 - 官方保留名称
 * 2. 黑名单模式 - 正则模式匹配冒充名称
 * 3. 同形攻击防护 - 检测 Unicode 非 ASCII 字符
 * 4. 源验证 - 官方名称必须来自可信源
 *
 * 参考: Claude Code schemas.ts:1-157
 */
/**
 * 官方保留市场名称
 * 仅官方市场允许使用这些名称，第三方注册会被拒绝
 */
export declare const ALLOWED_OFFICIAL_MARKETPLACE_NAMES: Set<string>;
/**
 * 检测冒充官方名称的正则模式
 *
 * 匹配以下变体：
 * - "official" + "codebuddy/anthropic/claude" (如 "official-codebuddy-plugins")
 * - "codebuddy/anthropic/claude" + "official" (如 "claude-official")
 * - "codebuddy/anthropic/claude" 开头 + 官方后缀 (如 "anthropic-marketplace-new")
 */
export declare const BLOCKED_OFFICIAL_NAME_PATTERN: RegExp;
/**
 * 检查市场名称是否冒充官方名称
 *
 * @param name 市场名称
 * @returns true 表示被阻止（冒充），false 表示允许
 */
export declare function isBlockedOfficialName(name: string): boolean;
/**
 * 验证官方名称的来源是否可信
 * 官方保留名称只能从可信的 GitHub 组织或官方 CDN 路径注册
 *
 * @param name 市场名称
 * @param source 市场源地址 (GitHub URL、org/repo 格式、或官方 CDN URL)
 * @returns true 表示来源可信，false 表示不可信
 */
export declare function validateOfficialNameSource(name: string, source?: string): boolean;
/**
 * 检查是否为官方市场名称（用于自动更新默认值等）
 */
export declare function isOfficialMarketplace(name: string): boolean;
/**
 * 检查市场是否默认启用自动更新
 * 官方市场默认启用（除了明确排除的），第三方默认不启用
 */
export declare function isMarketplaceAutoUpdateDefault(marketplaceName: string, autoUpdate?: boolean): boolean;
//# sourceMappingURL=marketplace-name-validator.d.ts.map