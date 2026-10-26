import type { BuiltinToolIdentity, ProjectionResult, ToolActionProjection } from './protocol';
export interface ToolRiskProjector {
    readonly identity: BuiltinToolIdentity;
    readonly acceptedInputSchemaFingerprints: readonly string[];
    project(input: unknown): ToolActionProjection | undefined;
}
export interface ToolRiskProjectorRegistry {
    createActionHash?(input: {
        identity: import('./protocol').ToolIdentity;
        inputSchemaFingerprint?: string;
        toolInput: unknown;
    }): string;
    project(input: {
        identity: BuiltinToolIdentity;
        currentInputSchemaFingerprint?: string;
        toolInput: unknown;
    }): ProjectionResult;
}
export declare function projectorIdentityKey(identity: BuiltinToolIdentity): string;
export declare function createToolRiskProjectorRegistry(projectors: readonly ToolRiskProjector[], options?: {
    hmacKey?: Buffer;
}): ToolRiskProjectorRegistry;
