export declare function mcpDescriptorEnvironment(environment: Readonly<NodeJS.ProcessEnv>, platform?: NodeJS.Platform): Readonly<NodeJS.ProcessEnv>;
/** Compatibility export for the existing USER descriptor API. */
export declare const userMcpDescriptorEnvironment: typeof mcpDescriptorEnvironment;
/** Minimal ambient environment for an isolated MCP subprocess. */
export declare function inheritedMcpEnvironment(environment: Readonly<NodeJS.ProcessEnv>, platform?: NodeJS.Platform): Record<string, string>;
