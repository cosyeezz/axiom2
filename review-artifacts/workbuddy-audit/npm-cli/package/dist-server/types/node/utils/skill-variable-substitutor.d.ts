import { type PluginEnvironmentContext } from '../../vendor/cbc-plugins/node/plugins/plugin-environment.js';
/**
 * 在 skill / command / agent .md 文件**加载时**替换占位符，对齐 Claude Code 行为。
 *
 * 替换顺序：
 *   1. `${CODEBUDDY_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_ROOT}` → extensionDir（仅插件来源）
 *   2. `${CODEBUDDY_SKILL_DIR}` / `${CLAUDE_SKILL_DIR}` → dirname(filePath)（所有来源）
 *   3. process.env 变量展开（所有来源；未找到的占位符静默保留）
 *
 * `${CODEBUDDY_SESSION_ID}` / `${CLAUDE_SESSION_ID}` 在运行时由 skill-tool.ts 注入，
 * 不在此处处理（加载时无 session 上下文）。即使 process.env 中意外存在同名变量，
 * 也不能被 env 展开吞掉，否则运行时注入路径会找不到占位符。
 *
 * @param content     .md 文件正文（frontmatter 已剥离）
 * @param filePath    .md 文件的绝对路径，用于推导 SKILL_DIR
 * @param extensionDir 插件根目录（仅插件来源传入）；用户/项目来源不传此参数
 * @param pluginEnvironment 插件路径、data 目录和 user_config 上下文
 */
export declare function substituteLoadTimeVariables(content: string, filePath: string, extensionDir?: string, pluginEnvironment?: PluginEnvironmentContext): string;
/**
 * Plugin content may reference a persistent data directory. Keep the pure
 * substitution helper synchronous for non-plugin callers, and perform the
 * directory I/O asynchronously at plugin load time.
 */
export declare function substitutePluginLoadTimeVariables(content: string, filePath: string, extensionDir: string | undefined, pluginEnvironment: PluginEnvironmentContext): Promise<string>;
