import { type Event } from '@celljs/core';
import { McpConfig, McpScope, McpServerModel, McpServerStatus } from '../mcp-protocol';
export declare class McpServerModelImpl implements McpServerModel {
    readonly scope: McpScope;
    readonly name: string;
    readonly config: McpConfig;
    private _state;
    private _status;
    private _statusEmitter;
    get onDidChangeStatus(): Event<McpServerStatus>;
    get status(): McpServerStatus;
    set status(value: McpServerStatus);
    needsAuth: boolean;
    constructor(scope: McpScope, name: string, config: McpConfig);
    private generateState;
    state(): string;
    isActive(): boolean;
}
