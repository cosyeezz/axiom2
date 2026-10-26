export declare const MOD_CLIENT_INSPECT_CONTRACTS: readonly [{
    readonly id: 'Command';
    readonly description: 'Paged read-only declared, registered and busy Mod commands; never loads or executes code';
    readonly method: 'listCommands';
    readonly inputSchema: {
        type: string;
        required: string[];
        properties: Record<string, object>;
        additionalProperties: boolean;
    };
    readonly outputSchema: {
        type: string;
        required: string[];
        properties: Record<string, object>;
        additionalProperties: boolean;
    };
}, {
    readonly id: 'Slots';
    readonly description: 'Live browser slots, occupants and registration props';
    readonly method: 'listSubTree';
    readonly inputSchema: {
        type: string;
        required: string[];
        properties: Record<string, object>;
        additionalProperties: boolean;
    };
    readonly outputSchema: {
        type: string;
        required: string[];
        properties: Record<string, object>;
        additionalProperties: boolean;
    };
}, {
    readonly id: 'Service';
    readonly description: 'Browser services available to approved client plugins';
    readonly method: 'listService';
    readonly inputSchema: {
        type: string;
        required: string[];
        properties: Record<string, object>;
        additionalProperties: boolean;
    };
    readonly outputSchema: {
        type: string;
        required: string[];
        properties: Record<string, object>;
        additionalProperties: boolean;
    };
}, {
    readonly id: 'Event';
    readonly description: 'Owned browser change subscriptions';
    readonly method: 'listEvents';
    readonly inputSchema: {
        type: string;
        required: string[];
        properties: Record<string, object>;
        additionalProperties: boolean;
    };
    readonly outputSchema: {
        type: string;
        required: string[];
        properties: Record<string, object>;
        additionalProperties: boolean;
    };
}, {
    readonly id: 'Builtin';
    readonly description: 'Plain JavaScript client closure symbols';
    readonly method: 'listBuiltins';
    readonly inputSchema: {
        type: string;
        required: string[];
        properties: Record<string, object>;
        additionalProperties: boolean;
    };
    readonly outputSchema: {
        type: string;
        required: string[];
        properties: Record<string, object>;
        additionalProperties: boolean;
    };
}, {
    readonly id: 'Theme';
    readonly description: 'Current semantic palette, native design variables and plugin-contributed theme tokens';
    readonly method: 'listTokens';
    readonly inputSchema: {
        type: string;
        required: string[];
        properties: Record<string, object>;
        additionalProperties: boolean;
    };
    readonly outputSchema: {
        type: string;
        required: string[];
        properties: Record<string, object>;
        additionalProperties: boolean;
    };
}, {
    readonly id: 'Runtime';
    readonly description: 'This exact page URL, loaded plugins and render diagnostics';
    readonly method: 'snapshot';
    readonly inputSchema: {
        type: string;
        required: string[];
        properties: Record<string, object>;
        additionalProperties: boolean;
    };
    readonly outputSchema: {
        type: string;
        required: string[];
        properties: Record<string, object>;
        additionalProperties: boolean;
    };
}];
//# sourceMappingURL=mod-inspect-contract.d.ts.map