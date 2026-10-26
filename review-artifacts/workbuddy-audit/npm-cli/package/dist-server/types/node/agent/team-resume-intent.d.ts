import type { AgentInputItem } from '../../vendor/cbc-shared/node/index.js';
/**
 * A narrowly-scoped capability carried by one real user turn.
 *
 * This is deliberately a run property, not Session state. A Session can have a
 * cancelled/stale run finishing while a newer user prompt is already queued;
 * putting the capability on Session would let the old run (or an internal team
 * inbox drain) revive a teammate soft-paused by cancellation of its lead turn.
 */
export type TeamResumeIntent = 'human';
/** Mark a trusted user message as a real human team-resume turn. */
export declare function markHumanTeamResumeIntent(input: AgentInputItem[]): void;
export declare function hasHumanTeamResumeIntent(input: AgentInputItem[]): boolean;
/**
 * Consume and strip human-turn markers after queue merge/drain.
 *
 * Stripping happens at priority 1775, before History (1400), so this internal
 * capability can never be replayed from persisted conversation history.
 */
export declare function consumeHumanTeamResumeIntent(input: AgentInputItem[]): TeamResumeIntent | undefined;
