import type { Logger } from '@celljs/core';
import type { ActivePluginRuntimeEntry, PluginInfo } from '../../vendor/cbc-plugins/node/index.js';
import type { Agent as ProductAgentConfiguration } from '@genie/product';
export declare const COMPOSE_MARKETPLACE_NAME = "workbuddy-builtin";
export declare const ROOT_PLUGIN_PREFIX = "welcomemode-";
export declare const FRAGMENT_PLUGIN_PREFIX = "interactionmode-";
/**
 * Every welcomemode template includes fragments from this plugin, but it
 * carries neither prefix. It is resolved through the generic compose plugin
 * map, so name it explicitly wherever the compose input set matters.
 */
export declare const SHARED_FRAGMENT_PLUGIN_NAME = "prompt-common";
export interface PluginComposeRef {
    name: string;
    marketplaceName: string;
}
/** Plugin settings are a base layer: the last declared agent wins, as in the CLI. */
export declare function selectPluginAgentSetting(plugins: readonly ActivePluginRuntimeEntry[]): {
    entry: ActivePluginRuntimeEntry;
    agentName: string;
} | undefined;
/**
 * Whether a plugin contributes to the composed system prompt.
 *
 * Callers that must know the prompt is final before dispatching a turn share
 * this predicate so the wait set can never drift from what compose actually
 * reads.
 */
export declare function isComposePluginRef(plugin: PluginComposeRef): boolean;
export interface ComposePluginAgentInput {
    agentConfig: ProductAgentConfiguration;
    matchedPlugin?: PluginComposeRef;
    enabledPlugins: PluginInfo[];
    logger: Logger;
}
export declare function composePluginAgent(input: ComposePluginAgentInput): Promise<ProductAgentConfiguration | undefined>;
