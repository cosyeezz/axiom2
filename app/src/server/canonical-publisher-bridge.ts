import type { AgentSession, AgentSessionEvent, SessionManager } from "@earendil-works/pi-coding-agent";
import {
  observeCanonicalNativeManager, type CanonicalNativeObserver, type NativeEntryObservation,
  type NativeMutationObservation, type NativeObservationState,
} from "./canonical-native-observer.js";
import {
  installCanonicalPublisherMux, type CanonicalPublisherInvocation, type CanonicalPublisherMux,
} from "./canonical-publisher-mux.js";

const linkIdentity = Symbol("canonical-publisher-native-link");
export type CanonicalPublisherNativeLink = {
  readonly [linkIdentity]: true;
  readonly invocation: CanonicalPublisherInvocation;
  readonly sequence: number;
  readonly before: NativeObservationState;
  readonly after: NativeObservationState;
  readonly entry: NativeEntryObservation;
};
type Publisher = Pick<AgentSession, "sessionManager" | "subscribe" | "dispose">;
export type CanonicalPublisherBridge = {
  readonly attachPublisher: (publisher: Publisher) => void;
  readonly active: () => boolean;
  readonly owns: (value: unknown) => boolean;
  readonly isCurrent: (value: unknown) => boolean;
  readonly revoke: () => void;
};
type Options = {
  readonly manager: SessionManager;
  readonly onLink: (link: CanonicalPublisherNativeLink) => undefined;
  readonly onRevoke: () => undefined;
};
type Classification = { readonly type: AgentSessionEvent["type"]; readonly raw?: object; readonly role?: string };
type Frame = {
  readonly invocation: CanonicalPublisherInvocation;
  readonly event: AgentSessionEvent;
  readonly begin: Classification;
  readonly parent: Frame | undefined;
  returned: boolean;
};
type Expected = {
  readonly invocation: CanonicalPublisherInvocation;
  readonly raw: object;
  readonly before: NativeObservationState;
  readonly sequence: number;
};
const sameState = (a: NativeObservationState, b: NativeObservationState) => a.sessionId === b.sessionId
  && a.sessionFile === b.sessionFile && a.leafId === b.leafId;
const ordinary = (role: string | undefined) => role === "system" || role === "user"
  || role === "assistant" || role === "toolResult";

/** Qualified ordinary synchronous producer only. Metadata links are not owned body/source authority.
 * Requires fixed manager identity and no external reentry throughout Seal→native completion,
 * including original-method serialization of all buffered data. Not a getter/Proxy sandbox.
 */
export function prepareCanonicalPublisherBridge(options: Options): CanonicalPublisherBridge {
  const { manager } = options;
  let onLink: Options["onLink"] | undefined = options.onLink;
  let onRevoke: Options["onRevoke"] | undefined = options.onRevoke;
  if (typeof onLink !== "function" || typeof onRevoke !== "function") {
    throw new TypeError("Canonical publisher bridge requires callback functions");
  }
  let live = true, attached = false, watermark = 0;
  let observer: CanonicalNativeObserver | undefined, mux: CanonicalPublisherMux | undefined;
  let publisher: Publisher | undefined, top: Frame | undefined, expected: Expected | undefined;
  const links = new WeakMap<object, NativeMutationObservation>();
  const tainted = new WeakSet<object>();
  const owns = (value: unknown) => typeof value === "object" && value !== null && links.has(value);
  const revoke = () => {
    if (!live) return;
    live = false;
    expected = undefined; top = undefined; onLink = undefined;
    const callback = onRevoke; onRevoke = undefined;
    try { observer?.revoke(); } catch { /* Compensate only owned observation. */ }
    try { mux?.revoke(); } catch { /* Never dispose or restore foreign wrappers. */ }
    try { callback?.(); } catch { /* Preserve SDK/user control flow. */ }
  };
  const fixedManager = () => {
    if (!live) return false;
    try { if (publisher?.sessionManager === manager) return true; } catch { /* Observation fault. */ }
    revoke();
    return false;
  };
  const active = () => {
    if (!live || !attached) return false;
    if (!fixedManager()) return false;
    if (!observer?.active() || !mux?.active()) { revoke(); return false; }
    return true;
  };
  const classify = (event: AgentSessionEvent): Classification => {
    const type = event.type;
    if (type !== "message_start" && type !== "message_end") return { type };
    const raw = event.message;
    if (typeof raw !== "object" || raw === null) return { type };
    const role = raw.role;
    if (role === "custom") tainted.add(raw);
    return { type, raw, role };
  };
  const onMutation = (record: NativeMutationObservation) => {
    const awaiting = expected; expected = undefined;
    const previous = watermark; watermark = record.sequence;
    if (!live) return;
    if (!observer || !observer.owns(record) || !observer.isCurrent(record) || record.sequence !== previous + 1) {
      revoke(); return;
    }
    if (record.before.sessionId !== record.after.sessionId || record.before.sessionFile !== record.after.sessionFile) {
      revoke(); return;
    }
    if (attached && !fixedManager()) return;
    if (!awaiting || !attached) return;
    if (!active()) return;
    if (record.before.sessionId !== awaiting.before.sessionId || record.before.sessionFile !== awaiting.before.sessionFile) {
      revoke(); return;
    }
    if (previous !== awaiting.sequence || record.sequence !== awaiting.sequence + 1
      || record.method !== "appendMessage" || record.outcome !== "returned"
      || !record.matchesArguments([awaiting.raw]) || !sameState(record.before, awaiting.before)
      || !record.entry || record.entry.type !== "message" || record.entry.parentId !== record.before.leafId
      || record.after.leafId !== record.entry.id) return;
    const link: CanonicalPublisherNativeLink = Object.freeze({
      [linkIdentity]: true as const, invocation: awaiting.invocation, sequence: record.sequence,
      before: record.before, after: record.after, entry: record.entry,
    });
    links.set(link, record);
    const callback = onLink;
    if (callback && callback(link) !== undefined) revoke();
    // Violation-defense only: callbacks are required to be passive. Never restore the old watermark.
    if (live) fixedManager();
  };
  try {
    observer = observeCanonicalNativeManager({ manager, onMutation, onRevoke: () => { revoke(); } });
  } catch (error) {
    // Pure preflight never signals onRevoke; partial installation signals it before throwing.
    live = false; onLink = undefined; onRevoke = undefined; expected = undefined; top = undefined;
    throw error;
  }
  if (!live || !observer.active()) {
    revoke(); observer.revoke();
    throw new TypeError("Canonical publisher bridge initialized inactive");
  }
  const attachPublisher = (candidate: Publisher) => {
    if (!live) throw new TypeError("Canonical publisher bridge is inactive");
    if (attached) throw new TypeError("Canonical publisher bridge was already attached");
    if (candidate.sessionManager !== manager) throw new TypeError("Canonical publisher bridge manager mismatch");
    publisher = candidate;
    try {
      mux = installCanonicalPublisherMux({
        publisher: candidate,
        onBegin: (invocation, event) => {
          expected = undefined;
          if (active()) top = { invocation, event, begin: classify(event), parent: top, returned: false };
          return undefined;
        },
        onDispatchEnd: (invocation, outcome) => {
          if (!live) return undefined;
          const frame = top;
          if (!frame || frame.invocation !== invocation || frame.returned) { revoke(); return undefined; }
          if (outcome === "threw") top = frame.parent;
          else frame.returned = true;
          return undefined;
        },
        onSeal: (invocation, event) => {
          if (!live) return undefined;
          const frame = top;
          if (!frame || frame.invocation !== invocation || frame.event !== event || !frame.returned) {
            revoke(); return undefined;
          }
          top = frame.parent;
          if (!active()) return undefined;
          const final = classify(event), begin = frame.begin;
          if (begin.type !== "message_end" || final.type !== "message_end" || !final.raw
            || begin.raw !== final.raw || begin.role !== final.role || !ordinary(final.role)
            || tainted.has(final.raw)) return undefined;
          const before: NativeObservationState = Object.freeze({
            sessionId: manager.getSessionId(), sessionFile: manager.getSessionFile(), leafId: manager.getLeafId(),
          });
          const last = observer!.last();
          if (last ? !observer!.isCurrent(last) || last.sequence !== watermark : watermark !== 0) {
            revoke(); return undefined;
          }
          expected = { invocation, raw: final.raw, before, sequence: watermark };
          return undefined;
        },
        onRevoke: () => { revoke(); return undefined; },
      });
      if (!live || !mux.active() || !observer!.active()) {
        revoke(); mux.revoke(); observer!.revoke();
        throw new TypeError("Canonical publisher bridge attached inactive");
      }
      attached = true;
    } catch (error) {
      revoke();
      throw error;
    }
  };
  return Object.freeze({ attachPublisher, active, owns,
    isCurrent: (value: unknown) => active() && owns(value) && observer!.isCurrent(links.get(value as object)),
    revoke,
  });
}
