import { type Session } from '../../vendor/cbc-core/node/index.js';
export { getSessionCanUseTool, setSessionCanUseTool, } from '../../vendor/cbc-core/node/index.js';
/** Whether an ask decision has a real response channel for this session. */
export declare function isToolApprovalInteractionAvailable(session: Session | undefined): boolean;
