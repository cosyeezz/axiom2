import { type ToolIdentity } from './protocol';
export interface ToolActionHashInput {
    identity: ToolIdentity;
    inputSchemaFingerprint?: string;
    toolInput: unknown;
}
export declare function createToolActionHash(input: ToolActionHashInput, hmacKey?: Buffer): string;
