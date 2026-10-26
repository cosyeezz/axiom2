/**
 * IDE Integration Protocol Definitions
 *
 * Defines types and schemas for IDE-specific MCP extensions
 */
import { z } from 'zod';
import type { Subject, BehaviorSubject } from 'rxjs';
export declare const IDEMcpServer: unique symbol;
export declare const IDEDetector: unique symbol;
export declare const IDEService: unique symbol;
/**
 * IDE middleware priority - should run after session creation but before main logic
 */
export declare const IDE_MIDDLEWARE_PRIORITY: number;
/**
 * IDE Notification: selection_changed
 * Sent when user changes selection in the IDE
 */
export declare const SelectionChangedNotificationSchema: z.ZodObject<{
    method: z.ZodLiteral<"selection_changed">;
    params: z.ZodObject<{
        selection: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            start: z.ZodObject<{
                line: z.ZodNumber;
                character: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                line: number;
                character: number;
            }, {
                line: number;
                character: number;
            }>;
            end: z.ZodObject<{
                line: z.ZodNumber;
                character: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                line: number;
                character: number;
            }, {
                line: number;
                character: number;
            }>;
        }, "strip", z.ZodTypeAny, {
            end: {
                line: number;
                character: number;
            };
            start: {
                line: number;
                character: number;
            };
        }, {
            end: {
                line: number;
                character: number;
            };
            start: {
                line: number;
                character: number;
            };
        }>>>;
        text: z.ZodOptional<z.ZodString>;
        filePath: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        text?: string | undefined;
        filePath?: string | undefined;
        selection?: {
            end: {
                line: number;
                character: number;
            };
            start: {
                line: number;
                character: number;
            };
        } | null | undefined;
    }, {
        text?: string | undefined;
        filePath?: string | undefined;
        selection?: {
            end: {
                line: number;
                character: number;
            };
            start: {
                line: number;
                character: number;
            };
        } | null | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    method: "selection_changed";
    params: {
        text?: string | undefined;
        filePath?: string | undefined;
        selection?: {
            end: {
                line: number;
                character: number;
            };
            start: {
                line: number;
                character: number;
            };
        } | null | undefined;
    };
}, {
    method: "selection_changed";
    params: {
        text?: string | undefined;
        filePath?: string | undefined;
        selection?: {
            end: {
                line: number;
                character: number;
            };
            start: {
                line: number;
                character: number;
            };
        } | null | undefined;
    };
}>;
/**
 * IDE Notification: at_mentioned
 * Sent when the agent is @mentioned in the IDE
 */
export declare const AtMentionedNotificationSchema: z.ZodObject<{
    method: z.ZodLiteral<"at_mentioned">;
    params: z.ZodObject<{
        filePath: z.ZodString;
        lineStart: z.ZodOptional<z.ZodNumber>;
        lineEnd: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        filePath: string;
        lineStart?: number | undefined;
        lineEnd?: number | undefined;
    }, {
        filePath: string;
        lineStart?: number | undefined;
        lineEnd?: number | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    method: "at_mentioned";
    params: {
        filePath: string;
        lineStart?: number | undefined;
        lineEnd?: number | undefined;
    };
}, {
    method: "at_mentioned";
    params: {
        filePath: string;
        lineStart?: number | undefined;
        lineEnd?: number | undefined;
    };
}>;
/**
 * IDE Notification: ide_connected
 * Sent by CodeBuddy Code to IDE when connection is established
 */
export declare const IDEConnectedNotificationSchema: z.ZodObject<{
    method: z.ZodLiteral<"ide_connected">;
    params: z.ZodObject<{
        timestamp: z.ZodNumber;
        version: z.ZodString;
        pid: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        version: string;
        timestamp: number;
        pid?: number | undefined;
    }, {
        version: string;
        timestamp: number;
        pid?: number | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    method: "ide_connected";
    params: {
        version: string;
        timestamp: number;
        pid?: number | undefined;
    };
}, {
    method: "ide_connected";
    params: {
        version: string;
        timestamp: number;
        pid?: number | undefined;
    };
}>;
/**
 * IDE Tool: openFile
 */
export declare const OpenFileArgsSchema: z.ZodObject<{
    filePath: z.ZodString;
    preview: z.ZodOptional<z.ZodBoolean>;
    startText: z.ZodOptional<z.ZodString>;
    endText: z.ZodOptional<z.ZodString>;
    selectToEndOfLine: z.ZodOptional<z.ZodBoolean>;
    makeFrontmost: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    filePath: string;
    preview?: boolean | undefined;
    startText?: string | undefined;
    endText?: string | undefined;
    selectToEndOfLine?: boolean | undefined;
    makeFrontmost?: boolean | undefined;
}, {
    filePath: string;
    preview?: boolean | undefined;
    startText?: string | undefined;
    endText?: string | undefined;
    selectToEndOfLine?: boolean | undefined;
    makeFrontmost?: boolean | undefined;
}>;
/**
 * IDE Tool: openDiff (file modification preview)
 */
export declare const OpenDiffArgsSchema: z.ZodObject<{
    old_file_path: z.ZodString;
    new_file_path: z.ZodString;
    new_file_contents: z.ZodString;
    tab_name: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    old_file_path: string;
    new_file_path: string;
    new_file_contents: string;
    tab_name?: string | undefined;
}, {
    old_file_path: string;
    new_file_path: string;
    new_file_contents: string;
    tab_name?: string | undefined;
}>;
/**
 * IDE Tool: getDiagnostics
 */
export declare const GetDiagnosticsArgsSchema: z.ZodObject<{
    uri: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    uri?: string | undefined;
}, {
    uri?: string | undefined;
}>;
/**
 * IDE Tool: close_tab
 */
export declare const CloseTabArgsSchema: z.ZodObject<{
    tab_name: z.ZodString;
}, "strip", z.ZodTypeAny, {
    tab_name: string;
}, {
    tab_name: string;
}>;
export type SelectionChangedNotification = z.infer<typeof SelectionChangedNotificationSchema>;
export type SelectionChangedParams = SelectionChangedNotification['params'];
export type AtMentionedNotification = z.infer<typeof AtMentionedNotificationSchema>;
export type AtMentionedParams = AtMentionedNotification['params'];
export type IDEConnectedNotification = z.infer<typeof IDEConnectedNotificationSchema>;
export type OpenFileArgs = z.infer<typeof OpenFileArgsSchema>;
export type OpenDiffArgs = z.infer<typeof OpenDiffArgsSchema>;
export type GetDiagnosticsArgs = z.infer<typeof GetDiagnosticsArgsSchema>;
export type CloseTabArgs = z.infer<typeof CloseTabArgsSchema>;
export type IDETransportType = 'sse-ide' | 'ws-ide';
export interface IDEConnectionConfig {
    type: IDETransportType;
    url: string;
    ideName: string;
    authToken?: string;
    ideRunningInWindows?: boolean;
}
export interface IDELockFileData {
    workspaceFolders: string[];
    port: number;
    pid?: number;
    ideName?: string;
    ideKind?: 'vscode' | 'jetbrains';
    useWebSocket: boolean;
    runningInWindows: boolean;
    authToken?: string;
}
export interface AvailableIDE {
    url: string;
    name: string;
    workspaceFolders: string[];
    port: number;
    isValid: boolean;
    ideKind?: 'vscode' | 'jetbrains';
    authToken?: string;
    ideRunningInWindows?: boolean;
}
export interface IDEDetector {
    /**
     * Detect all available IDE instances
     * @param validateWorkspace Whether to validate that IDE workspace matches current directory
     */
    detectAvailableIDEs(validateWorkspace?: boolean): Promise<AvailableIDE[]>;
    /**
     * Check if CodeBuddy is running in an IDE terminal
     * Returns true if running in VSCode/Cursor/Windsurf or JetBrains IDE terminal
     */
    isInIDETerminal(): boolean;
    /**
     * Get IDE name from environment if running in IDE terminal
     * Returns IDE display name like "VS Code", "Cursor", "WebStorm", etc.
     */
    getIDENameFromEnvironment(): string | null;
    /**
     * Get IDE kind from environment if running in IDE terminal
     * Returns 'vscode' for VSCode-based IDEs, 'jetbrains' for JetBrains IDEs
     */
    getIDEKindFromEnvironment(): 'vscode' | 'jetbrains' | null;
}
export interface IDEMcpServer {
    /**
     * Connect to IDE using provided configuration
     */
    connect(config: IDEConnectionConfig): Promise<void>;
    /**
     * Set handler for selection_changed notification
     */
    setSelectionChangedHandler(handler: (notification: SelectionChangedNotification) => void | Promise<void>): void;
    /**
     * Set handler for at_mentioned notification
     */
    setAtMentionedHandler(handler: (notification: AtMentionedNotification) => void | Promise<void>): void;
    /**
     * Call openFile tool
     */
    openFile(args: OpenFileArgs): Promise<import('@modelcontextprotocol/sdk/types.js').CallToolResult>;
    /**
     * Call openDiff tool (file modification preview)
     */
    openDiff(args: OpenDiffArgs): Promise<{
        accepted: boolean;
        finalContent?: string;
    }>;
    /**
     * Call getDiagnostics tool
     */
    getDiagnostics(args?: GetDiagnosticsArgs): Promise<import('@modelcontextprotocol/sdk/types.js').CallToolResult>;
    /**
     * Call closeAllDiffTabs tool
     */
    closeAllDiffTabs(): Promise<void>;
    /**
     * Call close_tab tool
     */
    closeTab(args: CloseTabArgs): Promise<void>;
    /**
     * Close the connection
     */
    close(): Promise<void>;
    /**
     * Check if currently connected
     */
    isConnected(): boolean;
}
/**
 * IDE Service Interface
 * High-level service that manages IDE integration lifecycle
 */
export interface IDEService {
    /**
     * Subject for connection state changes
     * Directly exposed as per codebase convention (like BillingService, ConsoleManager, McpManager)
     */
    readonly connectionStateSubject: Subject<IDEConnectionEvent>;
    /**
     * Subject for IDE MCP server instances
     * Emits the server when successfully connected
     */
    readonly ideServerSubject: Subject<IDEMcpServer>;
    /**
     * Subject for selection change notifications from IDE
     * Emits only the params (not the full notification with method)
     * Use BehaviorSubject to allow accessing the latest selection via .value
     */
    readonly selectionChangedSubject: BehaviorSubject<SelectionChangedParams | undefined>;
    /**
     * Subject for at_mentioned notifications from IDE
     * Emits only the params (not the full notification with method)
     */
    readonly atMentionedSubject: Subject<AtMentionedParams>;
    /**
     * Get current connection state
     */
    getConnectionState(): IDEConnectionEvent;
    /**
     * Get currently connected IDE
     */
    getCurrentIDE(): AvailableIDE | null;
    /**
     * Detect all available IDEs
     */
    detectAvailableIDEs(validateWorkspace?: boolean): Promise<AvailableIDE[]>;
    /**
     * Auto-connect to first available IDE
     */
    autoConnect(validateWorkspace?: boolean): Promise<boolean>;
    /**
     * Connect to a specific IDE
     */
    connectToIDE(ide: AvailableIDE): Promise<void>;
    /**
     * Disconnect from current IDE
     */
    disconnect(): Promise<void>;
    /**
     * Enable auto-reconnect on connection loss
     */
    setAutoReconnect(enabled: boolean): void;
    /**
     * Get the underlying MCP server (for advanced usage)
     */
    getMcpServer(): IDEMcpServer;
    /**
     * Check if currently connected
     */
    isConnected(): boolean;
    /**
     * Set auto-connect requested flag (called by middleware)
     * Triggers auto-connect if not already connected
     */
    setAutoConnectRequested(requested: boolean): void;
    /**
     * Clean up resources
     */
    dispose(): Promise<void>;
}
/**
 * IDE connection state
 */
export declare enum IDEConnectionState {
    DISCONNECTED = "disconnected",
    CONNECTING = "connecting",
    CONNECTED = "connected",
    ERROR = "error"
}
/**
 * IDE connection event
 */
export interface IDEConnectionEvent {
    state: IDEConnectionState;
    ide?: AvailableIDE;
    server?: IDEMcpServer;
    error?: Error;
    timestamp: number;
}
