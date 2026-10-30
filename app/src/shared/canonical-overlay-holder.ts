import type { ChatMessage } from "./agent.js";
import { captureCanonicalSources } from "./canonical-source-capture.js";

type ReadonlyValue<T> = T extends object ? { readonly [K in keyof T]: ReadonlyValue<T[K]> } : T;
export interface CanonicalOverlayReceipt {
  readonly message: ReadonlyValue<ChatMessage>;
}
export interface CanonicalOverlayWriter {
  readonly write: (message: ReadonlyValue<ChatMessage>) => CanonicalOverlayReceipt | undefined;
  readonly release: (receipt: CanonicalOverlayReceipt) => boolean;
}
export interface CanonicalOverlayHolder {
  readonly begin: () => CanonicalOverlayWriter;
  readonly close: (writer: CanonicalOverlayWriter) => boolean;
  readonly snapshot: () => readonly CanonicalOverlayReceipt[];
}

/**
 * Local lifecycle and owned value-version capabilities only, NOT native lineage,
 * persistence, scope or overlay admission. The trusted producer must establish
 * those separately and retain the original writer/receipt for asynchronous work.
 */
export function createCanonicalOverlayHolder(): CanonicalOverlayHolder {
  let active: CanonicalOverlayWriter | undefined;
  const pending = new Map<string, CanonicalOverlayReceipt>();
  const claims = new WeakMap<CanonicalOverlayReceipt, { writer: CanonicalOverlayWriter; id: string }>();
  return Object.freeze({
    begin: () => {
      const writer: CanonicalOverlayWriter = Object.freeze({
        write: (message: ReadonlyValue<ChatMessage>) => {
          if (active !== writer) return undefined;
          const id = message.id;
          const owned = captureCanonicalSources({
            archive: { index: { revision: "overlay-holder-local", segments: [] }, messages: new Map() },
            currentGroups: [], currentMessages: new Map([[id, message]]), transientMessages: new Map(),
          }).message(id);
          if (!owned) throw new TypeError("Canonical overlay capture message is unavailable");
          if (active !== writer) return undefined;
          const receipt = Object.freeze({ message: owned });
          claims.set(receipt, { writer, id });
          pending.set(id, receipt);
          return receipt;
        },
        release: (receipt: CanonicalOverlayReceipt) => {
          if (active !== writer) return false;
          const claim = claims.get(receipt);
          if (!claim || claim.writer !== writer || pending.get(claim.id) !== receipt) return false;
          pending.delete(claim.id);
          return true;
        },
      });
      pending.clear();
      active = writer;
      return writer;
    },
    close: (writer: CanonicalOverlayWriter) => {
      if (!active || active !== writer) return false;
      active = undefined;
      pending.clear();
      return true;
    },
    snapshot: () => Object.freeze([...pending.values()]),
  });
}
