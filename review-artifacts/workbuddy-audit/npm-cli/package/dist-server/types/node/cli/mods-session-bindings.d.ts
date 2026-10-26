import type { ContextCompactSummarizer, InterruptionService, Session } from '../../vendor/cbc-core/node/index.js';
import type { Mods } from '../../vendor/cbc-plugins/node/index.js';
import type { AskService } from '../ask/ask-protoctol';
export interface ModsSessionDependencies {
    getSession(): Session;
    getAskService(): Pick<AskService, 'setAsk' | 'acquireAnswers' | 'rejectAsk'>;
    getInterruptionService(): Pick<InterruptionService, 'enqueueSandboxApproval' | 'reject' | 'pending$'>;
    getContextCompactSummarizer(): ContextCompactSummarizer;
}
/** A plugin's `$.session.compact` is running: the compaction it causes is not raised again. */
export declare function isPluginCompaction(): boolean;
export declare function createModsSessionBindings(deps: ModsSessionDependencies): Pick<Mods.HostBindings, 'ask' | 'compact'>;
