import type { AgentInputItem } from '../../../cbc-shared/node/index.js';
import type { SessionForkPointsPage } from './session-protocol';
/** Select from the store's canonical durable branch, never caller-supplied copied messages. */
export declare function selectSessionForkHistory(history: AgentInputItem[], atMessageId: string | null): AgentInputItem[];
export declare function sessionForkPointsPage(history: AgentInputItem[], limit?: number, beforeMessageId?: string): SessionForkPointsPage;
//# sourceMappingURL=session-fork-selection.d.ts.map