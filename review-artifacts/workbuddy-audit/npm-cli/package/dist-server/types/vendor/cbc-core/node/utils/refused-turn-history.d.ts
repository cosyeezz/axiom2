import type { AgentInputItem } from '../../../cbc-shared/node/index.js';
/** ACP refusal excludes the admitted turn from future model input, while leaving
 * the visible transcript intact. Only terminals attached to this active branch
 * apply; the journal remains the sole owner of the decision across cold loads. */
export declare function filterRefusedTurnHistory(input: AgentInputItem[], journal: AgentInputItem[]): AgentInputItem[];
/** Emergency compaction can trim the admitted user root from memory. Its durable
 * marker belongs to the same request and is the remaining model-input boundary. */
export declare function isCompactedRequestBoundary(item: AgentInputItem): boolean;
//# sourceMappingURL=refused-turn-history.d.ts.map