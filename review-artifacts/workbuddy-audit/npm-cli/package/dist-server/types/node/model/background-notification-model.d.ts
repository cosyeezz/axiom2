import type { Model } from '@openai/agents-core';
/**
 * A background completion may need no visible reply. Agents SDK 0.5.2 otherwise
 * treats an empty output list as another model step. Use its Model output contract
 * to finish normally, without changing the Runner's state machine or user turns.
 */
export declare function withBackgroundNotificationCompletion(model: Model): Model;
