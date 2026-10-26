import { type Session } from '../../vendor/cbc-core/node/index.js';
import { type UsageUpdateBuilderAgentManager, type UsageUpdateBuilderLogger } from '../acp/usage-update-builder';
import type { SessionEvent } from './types';
/**
 * Settled root-turn context snapshot with the 5-category breakdown
 * (`codebuddy.ai/usageByCategory`, conserved: sum === contextTokens).
 *
 * Per-input `usage` events stay cheap and category-free; the breakdown needs
 * the rendered dynamic instructions, so it is computed once per settled turn,
 * mirroring the ACP publisher's prompt_end snapshot. No measurement or a
 * failed computation yields no event — hosts keep their previous value.
 */
export declare function buildTurnUsageByCategoryEvent(session: Session, runId: string, agentManager: Pick<UsageUpdateBuilderAgentManager, 'getDefault'>, logger?: UsageUpdateBuilderLogger): Promise<SessionEvent | undefined>;
