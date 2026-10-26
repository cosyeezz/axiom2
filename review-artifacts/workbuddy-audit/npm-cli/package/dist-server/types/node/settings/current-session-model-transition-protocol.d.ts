import type { Session } from '../../vendor/cbc-core/node/index.js';
export declare const CurrentSessionModelTransition: unique symbol;
export type CurrentSessionModelScope = 'global' | 'session';
export type CurrentSessionModelTransitionResult = {
    status: 'applied';
    compacted: boolean;
    message: string;
} | {
    status: 'applied_with_persistence_warning';
    compacted: boolean;
    message: string;
} | {
    status: 'rejected';
    reason: 'busy' | 'too_small' | 'stale' | 'prepare_failed';
    message: string;
};
export interface CurrentSessionModelTransition {
    transition(input: {
        session: Session;
        targetModelId: string;
        scope: CurrentSessionModelScope;
    }): Promise<CurrentSessionModelTransitionResult>;
}
