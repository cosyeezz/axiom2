import type { CombineEvent, Session } from '../../vendor/cbc-core/node/index.js';
import type { SessionEventOrigin } from './types';
/** Copy only wire-safe lineage; never expose the live child Session reference. */
export declare function sessionEventOrigin(event: CombineEvent): SessionEventOrigin;
/** Attribute state to its executing turn; initial snapshots have no run identity. */
export declare function sessionStateOrigin(session: Session): SessionEventOrigin;
