import type { SecurityCenterFileRule } from '@genie/sandbox-cli/rule-config';
/**
 * 返回 WorkBuddy 配置根下需要保护的路径。
 *
 * 目录保留尾分隔符，让尚未创建的目录也按目录规则下发；项目文件规则保留
 * `*`，单星号只匹配一层目录，Windows 与 POSIX 使用各自原生分隔符。
 */
export declare function getWorkBuddyProtectedPaths(configDir: string, platform?: NodeJS.Platform): string[];
/**
 * 返回 WorkBuddy 平台数据的运行时文件规则：允许读取，修改和删除均需用户确认。
 */
export declare function getWorkBuddyProtectedFileRules(configDir: string, platform?: NodeJS.Platform): SecurityCenterFileRule[];
