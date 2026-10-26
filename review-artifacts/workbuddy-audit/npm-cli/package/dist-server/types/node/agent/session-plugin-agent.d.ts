/**
 * The composed plugin Agent belongs to one served session. The normal CLI
 * does not bind this slot and retains its process-level plugin assembly.
 * Instructions are rendered at run time; tools are consumed when building
 * the session's default Agent. Reload publishes the two fields together.
 */
import type { Session } from '../../vendor/cbc-core/node/index.js';
import type { Agent } from '@genie/product';
export declare function setSessionPluginAgent(session: Session, config: Agent | undefined): void;
export declare function getSessionPluginAgent(session: Session | undefined): Agent | undefined;
export declare function getSessionPluginAgentPrompt(session: Session | undefined): string | undefined;
