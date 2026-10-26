import { type MultitaskSessionRef, type PlannerDecision, type PlannerSpawnSibling, type SelfSnapshot } from './types';
export declare function autoSpawnJobs(decision: PlannerDecision): PlannerSpawnSibling[];
/** reminder 只认 snapshot.liveWorkers，禁止按 plan 形状谎称已拉起。 */
export declare function coordinatorPlanReminder(snapshot: SelfSnapshot): string;
export declare function applyPlannerDecision(session: MultitaskSessionRef & {
    id?: string;
}, userText: string): Promise<PlannerDecision>;
