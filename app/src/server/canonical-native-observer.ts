import type { SessionManager } from "@earendil-works/pi-coding-agent";

const mutations = [
  "appendMessage", "appendThinkingLevelChange", "appendModelChange", "appendUsage",
  "appendCompaction", "appendCustomEntry", "appendSessionInfo", "appendCustomMessageEntry",
  "appendContextEdit", "appendLabelChange", "branch", "resetLeaf", "branchWithSummary",
] as const satisfies readonly (keyof SessionManager)[];
const scopes = ["newSession", "setSessionFile", "createBranchedSession"] as const satisfies readonly (keyof SessionManager)[];
export type NativeMutationMethod = typeof mutations[number];
type ScopeMethod = typeof scopes[number];
type NativeMethod = NativeMutationMethod | ScopeMethod;
type EntryType = NonNullable<ReturnType<SessionManager["getEntry"]>>["type"];
const scopeMethods = new Set<string>(scopes);
const seen = new WeakSet<SessionManager>();
const entryTypes: Readonly<Record<NativeMutationMethod, EntryType | undefined>> = {
  appendMessage: "message", appendThinkingLevelChange: "thinking_level_change",
  appendModelChange: "model_change", appendUsage: "usage", appendCompaction: "compaction",
  appendCustomEntry: "custom", appendSessionInfo: "session_info",
  appendCustomMessageEntry: "custom_message", appendContextEdit: "context_edit",
  appendLabelChange: "label", branch: undefined, resetLeaf: undefined,
  branchWithSummary: "branch_summary",
};

export type NativeObservationState = {
  readonly sessionId: string;
  readonly sessionFile: string | undefined;
  readonly leafId: string | null;
};
export type NativeEntryObservation = {
  readonly id: string;
  readonly parentId: string | null;
  readonly type: EntryType;
};
export type NativeMutationObservation = {
  readonly method: NativeMutationMethod;
  readonly sequence: number;
  readonly outcome: "returned" | "threw";
  readonly before: NativeObservationState;
  readonly after: NativeObservationState;
  readonly entry?: NativeEntryObservation;
  /** Parameter identity/primitive values only, never an owned body version. */
  readonly matchesArguments: (args: readonly unknown[]) => boolean;
};
export type CanonicalNativeObserver = {
  readonly active: () => boolean;
  readonly last: () => NativeMutationObservation | undefined;
  readonly owns: (value: unknown) => boolean;
  readonly isCurrent: (value: unknown) => boolean;
  readonly revoke: () => void;
};

/** Trusted, exclusively owned SDK 1.1.0 manager; observed attempts are not native authority. */
export function observeCanonicalNativeManager(options: {
  readonly manager: SessionManager;
  readonly onMutation: (record: NativeMutationObservation) => void;
  readonly onRevoke?: () => void;
}): CanonicalNativeObserver {
  const { manager } = options;
  if (seen.has(manager)) throw new TypeError("Canonical native manager was already observed");
  if (!Object.isExtensible(manager)) throw new TypeError("Canonical native manager cannot be observed");
  const originals = new Map<NativeMethod, (...args: never[]) => unknown>();
  for (const name of [...mutations, ...scopes]) {
    const descriptor = Object.getOwnPropertyDescriptor(manager, name);
    if ((descriptor && (!("value" in descriptor) || !descriptor.writable || !descriptor.configurable))
      || typeof manager[name] !== "function") {
      throw new TypeError("Canonical native manager method cannot be observed");
    }
    originals.set(name, manager[name]);
  }
  let notify: typeof options.onMutation | undefined = options.onMutation;
  let onRevoke = options.onRevoke;
  let active = true, depth = 0, sequence = 0;
  let latest: NativeMutationObservation | undefined;
  const issued = new WeakSet<object>();
  const owns = (value: unknown) => typeof value === "object" && value !== null && issued.has(value);
  const revoke = () => {
    if (!active) return;
    active = false;
    notify = undefined;
    const callback = onRevoke;
    onRevoke = undefined;
    try { callback?.(); } catch { /* Observation failure never replaces SDK results. */ }
  };
  const readState = (): NativeObservationState => Object.freeze({
    sessionId: manager.getSessionId(), sessionFile: manager.getSessionFile(), leafId: manager.getLeafId(),
  });
  const readEntry = (method: NativeMutationMethod, result: unknown): NativeEntryObservation | undefined => {
    const expected = entryTypes[method];
    if (!expected) return undefined;
    let id: string;
    if (method === "appendUsage") {
      if (!result || typeof result !== "object" || !("id" in result) || typeof result.id !== "string"
        || manager.getEntry(result.id) !== result) throw new Error("Native usage entry is unavailable");
      id = result.id;
    } else {
      if (typeof result !== "string") throw new Error("Native returned entry is unavailable");
      id = result;
    }
    const entry = manager.getEntry(id);
    if (!entry || entry.id !== id || entry.type !== expected) throw new Error("Native entry metadata is inconsistent");
    return Object.freeze({ id: entry.id, parentId: entry.parentId, type: entry.type });
  };
  const isScope = (name: NativeMethod): name is ScopeMethod => scopeMethods.has(name);
  seen.add(manager);
  try {
    for (const name of [...mutations, ...scopes]) {
      const original = originals.get(name)!;
      Object.defineProperty(manager, name, {
        configurable: true, writable: true,
        enumerable: Object.getOwnPropertyDescriptor(manager, name)?.enumerable ?? false,
        value: function (this: SessionManager, ...args: unknown[]) {
          if (this !== manager || !active) return Reflect.apply(original, this, args);
          if (isScope(name)) {
            revoke();
            return Reflect.apply(original, this, args);
          }
          const outer = depth === 0;
          depth++;
          let before: NativeObservationState | undefined;
          if (outer) {
            try { before = readState(); } catch { revoke(); }
          }
          let result: unknown, threw = false;
          try { result = Reflect.apply(original, this, args); }
          catch (error) { threw = true; result = error; }
          finally { depth--; }
          if (outer && active && before) {
            try {
              const after = readState();
              const entry = threw ? undefined : readEntry(name, result);
              const record: NativeMutationObservation = Object.freeze({
                method: name, sequence: ++sequence, outcome: threw ? "threw" : "returned", before, after,
                ...(entry ? { entry } : {}),
                matchesArguments: (values: readonly unknown[]) => values.length === args.length
                  && args.every((value, index) => Object.is(value, values[index])),
              });
              issued.add(record);
              latest = record;
              notify?.(record);
            } catch { revoke(); }
          }
          if (threw) throw result;
          return result;
        },
      });
    }
  } catch (error) {
    revoke();
    throw error;
  }
  return Object.freeze({
    active: () => active, last: () => latest, owns,
    isCurrent: (value: unknown) => active && depth === 0 && owns(value) && latest === value,
    revoke,
  });
}
