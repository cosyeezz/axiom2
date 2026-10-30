import type { AgentSession, AgentSessionEvent, AgentSessionEventListener } from "@earendil-works/pi-coding-agent";

const invocationIdentity = Symbol("canonical-publisher-invocation");
export type CanonicalPublisherInvocation = { readonly [invocationIdentity]: true };
export type CanonicalPublisherMux = {
  readonly active: () => boolean;
  readonly revoke: () => void;
};
type Publisher = Pick<AgentSession, "subscribe" | "dispose">;
type Options = {
  readonly publisher: Publisher;
  readonly onBegin: (invocation: CanonicalPublisherInvocation, event: AgentSessionEvent) => undefined;
  readonly onDispatchEnd: (invocation: CanonicalPublisherInvocation, outcome: "returned" | "threw") => undefined;
  readonly onSeal: (invocation: CanonicalPublisherInvocation, event: AgentSessionEvent) => undefined;
  readonly onRevoke: () => undefined;
};
type Frame = {
  readonly event: AgentSessionEvent;
  readonly invocation: CanonicalPublisherInvocation;
  readonly parent: Frame | undefined;
  phase: "begun" | "dispatching" | "awaitingSeal" | "closed";
  began: boolean;
  ended: boolean;
};
const seen = new WeakSet<Publisher>();

/** Dispatch support, not source authority. Dispose is terminal; its internal reentry is outside this contract. */
export function installCanonicalPublisherMux(options: Options): CanonicalPublisherMux {
  const { publisher } = options;
  if (seen.has(publisher)) throw Error("Canonical publisher was already observed");
  if (!Object.isExtensible(publisher)) throw Error("Canonical publisher cannot be observed");
  const originals = { subscribe: publisher.subscribe, dispose: publisher.dispose };
  for (const name of ["subscribe", "dispose"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(publisher, name);
    if (typeof originals[name] !== "function" || descriptor && (!Object.hasOwn(descriptor, "value") || !descriptor.configurable)) {
      throw Error("Canonical publisher method cannot be observed");
    }
  }
  let active = true, terminal = false, routing = false;
  let users: AgentSessionEventListener[] = [];
  let top: Frame | undefined;
  let begin: Options["onBegin"] | undefined = options.onBegin;
  let end: Options["onDispatchEnd"] | undefined = options.onDispatchEnd;
  let seal: Options["onSeal"] | undefined = options.onSeal;
  let notify: Options["onRevoke"] | undefined = options.onRevoke;
  const revoke = () => {
    if (!active) return;
    active = false;
    begin = undefined; end = undefined; seal = undefined;
    const callback = notify; notify = undefined;
    try { callback?.(); } catch { /* Never replace user/SDK control flow with an observation failure. */ }
  };
  const pop = (frame: Frame) => {
    if (top === frame) { top = frame.parent; return true; }
    revoke();
    return false;
  };
  const first: AgentSessionEventListener = event => {
    if (!routing) return;
    try {
      const invocation: CanonicalPublisherInvocation = Object.freeze({ [invocationIdentity]: true as const });
      const frame: Frame = { event, invocation, parent: top, phase: "begun", began: false, ended: false };
      top = frame;
      if (active) { begin!(invocation, event); if (active) frame.began = true; }
    } catch { revoke(); }
  };
  const dispatch: AgentSessionEventListener = event => {
    const capturedUsers = users;
    let frame: Frame | undefined;
    if (routing) {
      if (top?.event === event && top.phase === "begun") { frame = top; frame.phase = "dispatching"; }
      else revoke();
    }
    let normal = false;
    try {
      for (const listener of capturedUsers) listener(event);
      normal = true;
    } finally {
      if (frame) {
        frame.phase = normal ? "awaitingSeal" : "closed";
        try {
          if (top !== frame) revoke();
          else if (active && frame.began) {
            end!(frame.invocation, normal ? "returned" : "threw");
            if (active) frame.ended = true;
          }
        } catch { revoke(); }
        finally { if (!normal) pop(frame); }
      }
    }
  };
  const last: AgentSessionEventListener = event => {
    if (!routing) return;
    const frame = top;
    if (!frame || frame.event !== event || frame.phase !== "awaitingSeal") { revoke(); return; }
    frame.phase = "closed";
    if (!pop(frame)) return;
    if (active && frame.began && frame.ended) {
      try { seal!(frame.invocation, event); } catch { revoke(); }
    }
  };
  const removals: (() => void)[] = [];
  seen.add(publisher);
  try {
    for (const callback of [first, dispatch, last]) removals.push(originals.subscribe.call(publisher, callback));
    Object.defineProperty(publisher, "subscribe", {
      configurable: true, writable: true,
      enumerable: Object.getOwnPropertyDescriptor(publisher, "subscribe")?.enumerable ?? false,
      value: function (this: Publisher, ...args: Parameters<Publisher["subscribe"]>) {
        if (this !== publisher || terminal) return Reflect.apply(originals.subscribe, this, args);
        const [listener] = args;
        users.push(listener);
        return () => {
          const index = users.indexOf(listener);
          if (index !== -1) users.splice(index, 1);
        };
      },
    });
    Object.defineProperty(publisher, "dispose", {
      configurable: true, writable: true,
      enumerable: Object.getOwnPropertyDescriptor(publisher, "dispose")?.enumerable ?? false,
      value: function (this: Publisher, ...args: Parameters<Publisher["dispose"]>) {
        if (this !== publisher) return Reflect.apply(originals.dispose, this, args);
        revoke();
        const result = Reflect.apply(originals.dispose, this, args);
        users = []; terminal = true;
        return result;
      },
    });
    routing = true;
  } catch (error) {
    routing = false;
    revoke();
    for (const remove of removals.reverse()) { try { remove(); } catch { /* Only best-effort removal of our own callbacks. */ } }
    throw error;
  }
  return Object.freeze({ active: () => active, revoke });
}
