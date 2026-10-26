import type { PlannerDecision } from './types';
/** 生产路径由 coordinator-interceptor 调用。 */
export declare function decide(input: {
    userText?: string;
    liveTaskIds?: readonly string[];
}): PlannerDecision;
