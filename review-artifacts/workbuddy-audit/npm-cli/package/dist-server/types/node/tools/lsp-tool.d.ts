/**
 * LSP Tool - 与 LSP 服务器交互以获取代码智能功能
 */
import { Session } from '../../vendor/cbc-core/node/index.js';
import { RunContext, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { Workspace } from '@genie/runtime';
import { Logger } from '@genie/telemetry';
import { z } from 'zod';
import { LSPManager } from '../lsp';
import { BaseTool } from './base-tool';
import { Tool, ToolResult } from './tool-protocol';
declare const LspParameters: z.ZodObject<{
    operation: z.ZodEnum<["goToDefinition", "findReferences", "hover", "documentSymbol", "workspaceSymbol", "goToImplementation", "prepareCallHierarchy", "incomingCalls", "outgoingCalls"]>;
    filePath: z.ZodString;
    line: z.ZodNumber;
    character: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    operation: "hover" | "goToDefinition" | "findReferences" | "documentSymbol" | "workspaceSymbol" | "goToImplementation" | "prepareCallHierarchy" | "incomingCalls" | "outgoingCalls";
    filePath: string;
    line: number;
    character: number;
}, {
    operation: "hover" | "goToDefinition" | "findReferences" | "documentSymbol" | "workspaceSymbol" | "goToImplementation" | "prepareCallHierarchy" | "incomingCalls" | "outgoingCalls";
    filePath: string;
    line: number;
    character: number;
}>;
export declare class LspTool extends BaseTool implements Tool {
    protected readonly logger: Logger;
    protected readonly workspace: Workspace;
    protected readonly lspManager: LSPManager;
    name: ToolNames;
    isConcurrencySafe(): boolean;
    aliases: string[];
    description: string;
    parameters: z.ZodObject<{
        operation: z.ZodEnum<["goToDefinition", "findReferences", "hover", "documentSymbol", "workspaceSymbol", "goToImplementation", "prepareCallHierarchy", "incomingCalls", "outgoingCalls"]>;
        filePath: z.ZodString;
        line: z.ZodNumber;
        character: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        operation: "hover" | "goToDefinition" | "findReferences" | "documentSymbol" | "workspaceSymbol" | "goToImplementation" | "prepareCallHierarchy" | "incomingCalls" | "outgoingCalls";
        filePath: string;
        line: number;
        character: number;
    }, {
        operation: "hover" | "goToDefinition" | "findReferences" | "documentSymbol" | "workspaceSymbol" | "goToImplementation" | "prepareCallHierarchy" | "incomingCalls" | "outgoingCalls";
        filePath: string;
        line: number;
        character: number;
    }>;
    private readonly MAX_RESULTS;
    execute(input: z.infer<typeof LspParameters>, context: RunContext<Session>): Promise<ToolResult>;
    /**
     * 执行 LSP 操作
     */
    private performOperation;
    private goToDefinition;
    private findReferences;
    private hover;
    private documentSymbol;
    private workspaceSymbol;
    private goToImplementation;
    private prepareCallHierarchy;
    private callHierarchy;
    private formatSymbols;
    private getSymbolKindName;
}
export {};
