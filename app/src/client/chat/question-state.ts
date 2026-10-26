import { useCallback, useSyncExternalStore } from "react";
import type { QuestionAnswer } from "../../shared/model-question.js";
// UI state must outlive virtual rows, including an unresolved submission.
interface QuestionState { answers: QuestionAnswer[]; expanded: boolean[]; collapsed?: boolean; submitted: boolean }
const states = new Map<string, QuestionState>();
const listeners = new Map<string, Set<() => void>>();
export function useQuestionState(key: string, count: number) {
  if (!states.has(key)) states.set(key, { answers: Array.from({ length: count }, () => ({ selected: [], text: "" })), expanded: Array.from({ length: count }, () => false), submitted: false });
  const state = useSyncExternalStore(useCallback(fn => {
    const group = listeners.get(key) ?? new Set(); listeners.set(key, group); group.add(fn);
    return () => { group.delete(fn); if (!group.size) listeners.delete(key); };
  }, [key]), () => states.get(key)!);
  const update = (change: Partial<QuestionState>) => {
    states.set(key, { ...states.get(key)!, ...change });
    listeners.get(key)?.forEach(fn => fn());
  };
  return [state, update] as const;
}
