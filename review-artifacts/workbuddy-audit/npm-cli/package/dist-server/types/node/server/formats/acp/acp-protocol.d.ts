export type * from '@agentclientprotocol/sdk';
export type { McpUiBroadcastPayload, ModelInfo } from '../../../acp/acp-protocol';
export interface AcpConnectionProfile {
    endpoint: 'canonical' | 'compatibility';
    compatibilityExtensions: boolean;
}
export declare const ACP_CANONICAL_CONNECTION_PROFILE: Readonly<AcpConnectionProfile>;
export declare const ACP_COMPATIBILITY_CONNECTION_PROFILE: Readonly<AcpConnectionProfile>;
