import type { SessionNotification } from '@agentclientprotocol/sdk';
import type { UpdateSessionNotification } from '@agentclientprotocol/sdk/experimental/v2';
import type { AgentInputItem } from '../../../../vendor/cbc-shared/node/index.js';
import type { AgentEvent } from '../../types';
export declare function itemNotifications(sessionId: string, item: AgentInputItem, replay: boolean, readFile?: (path: string) => Promise<Uint8Array>, includeSubmittedCommands?: boolean): Promise<SessionNotification[]>;
/** Live complete items and replay share content, tool and identity projection. */
export declare const projectAgentItem: (sessionId: string, item: AgentInputItem) => Promise<UpdateSessionNotification[]>;
/** Reuse the CLI's ACP extension vocabulary; the Agent only exports kernel facts. */
export declare const projectNativeEvent: (frame: AgentEvent, includeSubmittedCommands?: boolean) => Promise<SessionNotification[]>;
export declare function projectAgentEvent(frame: AgentEvent): Promise<UpdateSessionNotification[]>;
