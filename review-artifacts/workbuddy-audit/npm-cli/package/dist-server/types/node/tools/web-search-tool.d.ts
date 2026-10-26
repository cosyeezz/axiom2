import { AuthenticationManager } from '@genie/authentication';
import { Session } from '../../vendor/cbc-core/node/index.js';
import { type FunctionCallItem } from '../../vendor/cbc-shared/node/index.js';
import { ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { ClientInfoProvider, ProductManager } from '@genie/product';
import { Logger } from '@genie/telemetry';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { CustomHeadersProvider } from '../http';
import { ThreatDomainChecker } from '../sandbox-cli/threat-domain-checker';
import { SettingsManager } from '../settings';
import type { SandboxTelemetryReporter as ISandboxTelemetryReporter } from '../telemetry/sandbox-telemetry-protocol';
import { BaseTool } from './base-tool';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
declare const WebSearchParameters: z.ZodObject<{
    query: z.ZodString;
    allowed_domains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    blocked_domains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    freshness: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    query: string;
    allowed_domains?: string[] | undefined;
    blocked_domains?: string[] | undefined;
    freshness?: string | undefined;
}, {
    query: string;
    allowed_domains?: string[] | undefined;
    blocked_domains?: string[] | undefined;
    freshness?: string | undefined;
}>;
export declare class WebSearchTool extends BaseTool implements Tool {
    protected readonly productManager: ProductManager;
    protected readonly authenticationManager: AuthenticationManager;
    protected readonly clientInfoProvider: ClientInfoProvider;
    protected readonly settingsManager: SettingsManager;
    protected readonly customHeadersProvider: CustomHeadersProvider;
    protected readonly logger: Logger;
    protected readonly threatDomainChecker?: ThreatDomainChecker;
    protected readonly sandboxTelemetryReporter?: ISandboxTelemetryReporter;
    private readonly WEB_SEARCH_API_PATH;
    private readonly WEB_SEARCH_TIMEOUT_MS;
    name: ToolNames;
    isConcurrencySafe(): boolean;
    resolveSensitiveEgress(input: z.infer<typeof WebSearchParameters>): {
        source: "web-search";
        inspectionContent: string;
        destinationKey: string;
    } | undefined;
    parameters: z.ZodObject<{
        query: z.ZodString;
        allowed_domains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        blocked_domains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        freshness: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        query: string;
        allowed_domains?: string[] | undefined;
        blocked_domains?: string[] | undefined;
        freshness?: string | undefined;
    }, {
        query: string;
        allowed_domains?: string[] | undefined;
        blocked_domains?: string[] | undefined;
        freshness?: string | undefined;
    }>;
    argumentRenderer: ToolCallArgumentRenderer;
    aliases: string[];
    /** Auto mode classifier projection: the search query (Claude alignment, decision D1). */
    toAutoClassifierInput(input: unknown): string;
    execute(params: z.infer<typeof WebSearchParameters>, _context: RunContext<Session>, _details?: {
        toolCall: FunctionCallItem;
    }): Promise<ToolResult>;
    private filterUnsafeResults;
    private recordMaliciousDomainHit;
    private validateParams;
    private performWebSearch;
    private buildRequestBody;
    private buildStructuredResult;
    private formatSearchResults;
}
export {};
