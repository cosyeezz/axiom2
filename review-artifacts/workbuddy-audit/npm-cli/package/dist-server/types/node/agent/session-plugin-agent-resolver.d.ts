import { type ActivePluginRuntimeEntry } from '../../vendor/cbc-plugins/node/index.js';
import type { Agent, Command, Skill } from '@genie/product';
import type { McpConfig } from '../mcp';
/** A plugin package loaded from a directory for one session (QueryOptions.pluginRoots). */
export interface SessionPluginRootInput {
    /** `name@marketplace`: the plugin's identity in the session; the manifest name does not apply. */
    readonly id: string;
    /** Absolute plugin directory with its manifest under a metadata directory. */
    readonly path: string;
}
/** 一个会话已启用插件聚合出的、要路由进各会话车道的组件。 */
export interface SessionPluginComponents {
    /** One activation snapshot consumed by every plugin-backed Agent component. */
    activePlugins: readonly ActivePluginRuntimeEntry[];
    /** Composed settings.agent configuration; kept on this session, never in the global Agent map. */
    pluginAgent?: Agent;
    /** 各插件 MCP servers 并集（并进会话 MCP 车道）。 */
    mcpServers?: Record<string, McpConfig>;
    /** 各插件 skills 并集（并进会话 skills seam）。 */
    skills?: Skill[];
    /** 各插件 commands 并集（并进会话 commands seam）。 */
    commands?: Command[];
}
/**
 * 解析当前会话已启用会话档插件的组件。必须在 `rootScope.run(session)` 内调用。
 */
export declare function resolveSessionPluginComponents(pluginRoots?: readonly SessionPluginRootInput[]): Promise<SessionPluginComponents>;
