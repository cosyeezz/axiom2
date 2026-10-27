import type { AgentSession, BoundaryState } from "@earendil-works/pi-coding-agent";

/** Native serialized phases, NOT observations from message/tool stream events.
 * A boundary handler may propose drafts; only after-turn is after their commit.
 * See docs/session-safe-points.md for the contract and consumer inventory.
 */
export type SafePointSource =
  | { phase: "boundary"; boundary: Pick<BoundaryState, "outcome" | "entries"> }
  | { phase: "after-turn" | "before-next-turn"; signal?: AbortSignal }
  | { phase: "before-request" | "idle" }
  | { phase: "released"; active: boolean; owned: boolean }
  | { phase: "worker-idle"; requestInFlight: boolean };
export type SafePointOperation = "snapshot" | "compression-apply" | "compression-memory" |
  "model-switch" | "reload-pause" | "resource-reload" | "network-rebind" | "request-launch";
export interface SafePointState {
  session?: Pick<AgentSession, "isIdle" | "isCompacting"> & { agent: { state: { isStreaming: boolean } } };
  cancelled?: boolean;
  inputClosed?: boolean;
  transitioning?: boolean;
  /** Resource/model changes and cold reloads must not launch nested requests. */
  requestsBlocked?: boolean;
}
export interface SessionSafePoint {
  readonly phase: SafePointSource["phase"];
  allows(operation: SafePointOperation): boolean;
}

/** The single admission policy. Call again after awaits/at each queued operation;
 * a returned capability describes this serialized operation, not a lasting lock.
 * Business validation (identity, reminder delivery, persistence, CAS) stays outside.
 */
export function sessionSafePoint(source: SafePointSource, state: SafePointState = {}): SessionSafePoint {
  const { session } = state;
  const stopped = state.cancelled || ("signal" in source && source.signal?.aborted);
  const blocked = stopped || state.requestsBlocked;
  const selectionBlocked = blocked || state.inputClosed || state.transitioning;
  const allows = (operation: SafePointOperation): boolean => {
    if (blocked) return false;
    if (source.phase === "released")
      return !source.active && !source.owned && (operation === "snapshot" || operation === "compression-apply");
    if (source.phase === "worker-idle")
      return !source.requestInFlight && operation === "network-rebind";
    // No Session exists during initial network binding; this is not permission
    // to capture context, reload resources, or launch a model on a missing Session.
    if (!session && source.phase !== "boundary") return source.phase === "idle" && operation === "network-rebind";
    switch (source.phase) {
      case "boundary":
        if (operation === "snapshot") return true;
        if (operation === "compression-memory") return source.boundary.outcome === "completed";
        return operation === "compression-apply" && source.boundary.outcome === "completed" && source.boundary.entries.length === 0;
      case "after-turn":
      case "before-next-turn":
        // Failure recovery may use the new selection. Completion is a condition
        // for compression, not a model-availability gate or a history-wide check.
        return !selectionBlocked && (operation === "model-switch" || operation === "network-rebind" ||
          source.phase === "after-turn" && operation === "reload-pause");
      case "before-request":
        // Session.isStreaming remains true between native retry/continuation runs.
        // These entry hooks belong to Pi, not arbitrary low-level idle polling.
        // An already-entered native prompt owns phase-abort handoff. Do not turn
        // a late summary/input-close transition into an execution exception;
        // skip the selection, leaving native abort and the outer phase loop intact.
        return !session!.agent.state.isStreaming && !session!.isCompacting &&
          (operation === "request-launch" || !selectionBlocked && (operation === "model-switch" || operation === "network-rebind"));
      case "idle":
        if (!session!.isIdle) return false;
        // Owned idle resource work is safe even while a task phase is being
        // handed off. The outer lifecycle finishes that handoff before resuming.
        if (operation === "snapshot" || operation === "compression-apply" || operation === "resource-reload") return true;
        return !selectionBlocked && (operation === "model-switch" || operation === "network-rebind");
    }
  };
  // Snapshot the decision: an admitted model operation may set its own exclusive
  // flag before consuming the network capability. It is not a second admission.
  const permissions = new Set<SafePointOperation>([
    "snapshot", "compression-apply", "compression-memory", "model-switch", "reload-pause",
    "resource-reload", "network-rebind", "request-launch",
  ].filter(operation => allows(operation as SafePointOperation)) as SafePointOperation[]);
  return Object.freeze({ phase: source.phase, allows: (operation: SafePointOperation) => permissions.has(operation) });
}

type FinishTurn = NonNullable<AgentSession["agent"]["finishTurn"]>;
interface SafePointHooks {
  state(): SafePointState;
  applyModel(source: SafePointSource): Promise<void>;
  pauseReload(turn: Parameters<FinishTurn>[0], signal: Parameters<FinishTurn>[1], decision: Awaited<ReturnType<FinishTurn>>): ReturnType<FinishTurn>;
}

/** Keep every native entry in one place: prepare alone misses first requests,
 * finish alone misses choices arriving during retries and fresh continuations.
 * IPC handlers only queue intent. Never install these on public stream events.
 */
export function installSessionSafePointHooks(session: AgentSession, hooks: SafePointHooks) {
  const agent = session.agent, nativePrompt = agent.prompt, nativeContinue = agent.continue;
  const beforeRequest = async () => {
    const source = { phase: "before-request" } as const;
    if (!sessionSafePoint(source, hooks.state()).allows("request-launch"))
      throw Error("当前会话未到达模型请求安全点，不能发起嵌套请求。");
    await hooks.applyModel(source);
  };
  agent.prompt = (async (...args: Parameters<typeof nativePrompt>) => {
    await beforeRequest();
    await nativePrompt.apply(agent, args);
  }) as typeof nativePrompt;
  agent.continue = async () => {
    await beforeRequest();
    await nativeContinue.call(agent);
  };
  const prepare = agent.prepareNextTurnWithContext;
  agent.prepareNextTurnWithContext = async (turn, signal) => {
    await hooks.applyModel({ phase: "before-next-turn", signal });
    return prepare?.(turn, signal);
  };
  const finish = agent.finishTurn;
  agent.finishTurn = async (turn, signal) => {
    const decision = await finish?.(turn, signal);
    const source = { phase: "after-turn", signal } as const;
    await hooks.applyModel(source);
    if (!sessionSafePoint(source, hooks.state()).allows("reload-pause")) return decision || undefined;
    // Preserve Pi's continuation decision for the outer reload/resume lifecycle.
    return (await hooks.pauseReload(turn, signal, decision)) || decision || undefined;
  };
}
