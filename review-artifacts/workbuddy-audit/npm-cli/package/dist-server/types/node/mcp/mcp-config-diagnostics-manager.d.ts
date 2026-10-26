import { Subject } from 'rxjs';
import { McpConfigDiagnostic, McpConfigDiagnosticSeverity, McpConfigDiagnosticsManager, McpScope } from './mcp-protocol';
/**
 * Implementation of McpConfigDiagnosticsManager.
 *
 * Passively collects diagnostics for MCP server configurations.
 * This service is independent of other MCP services to avoid circular dependencies.
 */
export declare class McpConfigDiagnosticsManagerImpl implements McpConfigDiagnosticsManager {
    readonly changedSubject: Subject<McpConfigDiagnostic[]>;
    /**
     * Internal storage: array of all diagnostics
     */
    private diagnostics;
    addDiagnostic(diagnostic: McpConfigDiagnostic): void;
    addDiagnostics(diagnostics: McpConfigDiagnostic[]): void;
    getDiagnostics(): McpConfigDiagnostic[];
    getDiagnosticsForServer(serverName: string): McpConfigDiagnostic[];
    getDiagnosticsForServerScope(serverName: string, scope: McpScope): McpConfigDiagnostic[];
    getDiagnosticCount(severity?: McpConfigDiagnosticSeverity): number;
    hasDiagnostics(severity?: McpConfigDiagnosticSeverity): boolean;
    clearDiagnostics(): void;
    clearServerDiagnostics(serverName: string): void;
    clearServerScopeDiagnostics(serverName: string, scope: McpScope): void;
    /**
     * Check if a diagnostic is a duplicate (same serverName + scope + category + message)
     */
    private isDuplicate;
}
