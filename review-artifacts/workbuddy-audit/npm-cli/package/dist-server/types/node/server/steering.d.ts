import { type Session } from '../../vendor/cbc-core/node/index.js';
import { Effect } from 'effect';
import { RunState, SessionHooks, SteerBuffer, UserInputReview } from './services';
import type { SteerOptions, SteerResult } from './types';
export { prepareSteerMessages } from '../steer/steer-messages';
/** This runs in the target query's captured execution scope, not the caller's scope. */
export declare const admitSteer: (session: Session, input: string | unknown[], options: SteerOptions, isActive: () => boolean) => Effect.Effect<SteerResult, never, SteerBuffer | RunState | SessionHooks | UserInputReview>;
