import type { AgentInputItem } from '../../vendor/cbc-shared/node/index.js';
/**
 * Build the UI-only replay projection from item-local mappings.
 * Model-visible fields remain ciphertext-backed; missing or conflicting mappings stay encrypted.
 */
export declare function restoreSensitiveHistoryForReplay(history: readonly AgentInputItem[]): AgentInputItem[];
