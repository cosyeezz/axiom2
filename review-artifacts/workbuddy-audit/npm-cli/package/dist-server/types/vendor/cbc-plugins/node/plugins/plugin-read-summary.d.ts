import { type DataFs } from '../../../../node/data-fs/index.js';
import { type PluginInfo } from './plugin-protocol';
export interface PluginReadCommandSummary {
    name: string;
    description?: string;
    argumentHint?: string;
    /**
     * Resolved command file used by the private Harness skills inventory.
     * Metadata-only fallbacks intentionally omit this field because they do
     * not prove that an executable command artifact exists on disk.
     */
    path?: string;
}
export interface PluginReadAgentSummary {
    name: string;
    description?: string;
}
export interface PluginReadSkillSummary {
    name: string;
    description: string;
    enabled: boolean;
    path?: string;
    shortDescription?: string;
}
export interface PluginReadOutputStyleSummary {
    name: string;
    description?: string;
}
/**
 * Metadata-only projection used by the shared server Resource API.
 *
 * This is a hard serialization boundary. It must never contain prompt bodies,
 * agent instructions, hook handlers, MCP/LSP connection configuration, plugin
 * settings, or user credentials.
 */
export interface PluginReadComponentSummary {
    /** Resource root of a fully validated installed directory projection. */
    resourcePath?: string;
    agents: PluginReadAgentSummary[];
    /**
     * Private discovery diagnostic used by Harness skills/list. Public
     * plugin/read projection must strip this field.
     */
    ambiguousCommandNames?: string[];
    commands: PluginReadCommandSummary[];
    hooks: Record<string, never[]>;
    lspServers: string[];
    mcpServers: string[];
    outputStyles: PluginReadOutputStyleSummary[];
    skills: PluginReadSkillSummary[];
}
export interface PluginReadComponentOptions {
    filesystem?: DataFs;
    /** Locally materialized marketplace root used for pre-install discovery. */
    marketplacePath?: string;
}
/**
 * Read public plugin component metadata without loading runtime components.
 *
 * This function performs bounded, read-only access within the real plugin
 * root. In particular, it does not call getPluginComponents(), interpolate
 * plugin options/environment variables, download MCP bundles, extract
 * archives, register hooks, or start MCP/LSP processes.
 */
/** Catalog queries need only invocable resources, with the same root validation as plugin/read. */
export declare function readPluginCommandSummary(plugin: PluginInfo, options?: PluginReadComponentOptions): Promise<Pick<PluginReadComponentSummary, 'commands' | 'ambiguousCommandNames' | 'skills'>>;
export declare function readPluginComponentSummary(plugin: PluginInfo, options?: PluginReadComponentOptions): Promise<PluginReadComponentSummary>;
//# sourceMappingURL=plugin-read-summary.d.ts.map