import { type MultitaskSessionRef, type PlannerDecision, type SelfSnapshot } from './types';
export declare const SelfModel: {
    snapshot(session?: MultitaskSessionRef | null): SelfSnapshot;
};
export declare function readLastPlan(session?: MultitaskSessionRef | null): PlannerDecision | undefined;
export declare function writeLastPlan(session: MultitaskSessionRef, plan: PlannerDecision, turnKey: string): void;
export declare function readLastPlanTurn(session?: MultitaskSessionRef | null): string | undefined;
