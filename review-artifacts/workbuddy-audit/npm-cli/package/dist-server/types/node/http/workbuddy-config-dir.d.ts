/**
 * 解析 WorkBuddy 用户级配置目录的绝对路径。
 *
 * 优先级：
 *   1. `WORKBUDDY_CONFIG_DIR` 环境变量（被测试套件、企业部署、隔离场景使用）
 *   2. `~/.workbuddy`（默认）
 *
 * 与 `apps/workbuddy-desktop/src/main/system/runtime/app-instance.ts` 的
 * `getWorkbuddyConfigDir` 行为一致 —— 但 agent-cli 不依赖 desktop main，
 * 所以这里维护一份独立的、零依赖的实现。
 *
 * v5 #49077：用于给 ProxyResolver 注入 settingsPath，避免 ProxyResolver class
 * 内部默认值（`os.homedir()/.workbuddy/settings.json`）在
 * `WORKBUDDY_CONFIG_DIR` 被设置时仍然指错位置。
 */
export declare function getWorkbuddyConfigDir(): string;
export declare function getWorkbuddySettingsPath(): string;
