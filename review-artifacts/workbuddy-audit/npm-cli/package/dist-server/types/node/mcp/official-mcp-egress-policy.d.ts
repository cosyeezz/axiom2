import { type Provider } from '@celljs/core';
import { type SensitiveEgressReusePolicy as SensitiveEgressReusePolicyInterface, type ToolEgressReviewRequest } from '../sensitive-content/sensitive-content-protocol';
import { McpPluginRegistry } from './mcp-plugin-registry';
import { AgentScopedMcpManager, type McpServerModelManager as McpServerModelManagerInterface } from './mcp-protocol';
export declare class OfficialMcpEgressPolicy implements SensitiveEgressReusePolicyInterface {
    private readonly bundledIdentityCache;
    protected readonly agentScopedMcpProvider?: Provider<AgentScopedMcpManager>;
    protected readonly mcpPluginRegistry?: McpPluginRegistry;
    protected readonly mcpServerModelManager?: McpServerModelManagerInterface;
    resolveCandidates(request: ToolEgressReviewRequest): readonly string[] | undefined;
    private matchesIdentity;
    private matchesBundledDynamicIdentity;
    private verifyBundledStdioIdentity;
    private isNodeCommand;
    private hasBundledPluginPath;
    private matchesManifest;
    private parseDestination;
    private parsePayload;
}
