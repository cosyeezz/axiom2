import type { BuiltinToolActionProjection, BuiltinToolIdentity, ToolEffectTag } from '../protocol';
import type { InScopeBuiltinToolName } from '../scope';
export interface BoundedProjectionText {
    text: string;
    originalChars: number;
    truncated: boolean;
}
export declare function genieBuiltinIdentity(toolName: InScopeBuiltinToolName): BuiltinToolIdentity;
export declare function isRecord(value: unknown): value is Record<string, unknown>;
export declare function boundedProjectionText(value: string, maxChars?: number): BoundedProjectionText;
export declare function createToolActionProjection(toolName: InScopeBuiltinToolName, effectTags: ToolEffectTag[], classifier: Record<string, unknown>): BuiltinToolActionProjection | undefined;
export declare function optionalString(record: Record<string, unknown>, key: string): string | undefined;
export declare function optionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined;
export declare function optionalNumber(record: Record<string, unknown>, key: string): number | undefined;
export declare function optionalStringArray(record: Record<string, unknown>, key: string): string[] | undefined;
