import type { AgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import type { ChatMessage, RunOrigin } from "../shared/agent.js";
import { captureCanonicalSources, type CanonicalSourceCapture } from "../shared/canonical-source-capture.js";
import { createCanonicalOverlayHolder, type CanonicalOverlayReceipt } from "../shared/canonical-overlay-holder.js";
import { threadGroups } from "../shared/thread-layout.js";
import { historyProjection } from "./history-projection.js";
import { prepareCanonicalPublisherBridge } from "./canonical-publisher-bridge.js";
import { transcriptMessages } from "./transcript.js";

/** One exclusively owned worker session. Never transferred across a run/lease.
 * The bridge confirms native completion, not body authority: finalized bodies are
 * always projected from this manager; live bodies are owned display snapshots.
 */
export function prepareCanonicalLiveSource(manager: SessionManager) {
  const holder = createCanonicalOverlayHolder();
  let writer = holder.begin(), live = true, ready = false;
  let epoch = 0;
  let pending = new WeakMap<object, CanonicalOverlayReceipt>();
  // Execution end or ordinary toolResult fences late execution callbacks.
  // This is a display fence, not an assertion that native append succeeded.
  let toolFences = new Set<string>();
  let toolPending = new Map<string, CanonicalOverlayReceipt>();
  const close = () => {
    live = false; ready = false; pending = new WeakMap(); toolFences.clear(); toolPending.clear(); holder.close(writer);
  };
  const bridge = prepareCanonicalPublisherBridge({ manager,
    onRevoke: () => { close(); return undefined; },
    onLink: link => {
      const entry = manager.getEntry(link.entry.id);
      if (entry?.type === "message") {
        const raw = entry.message as typeof entry.message & { axiomId?: string };
        if (raw.role === "toolResult" && typeof raw.axiomId === "string") {
          toolFences.add(raw.axiomId);
          const tool = toolPending.get(raw.axiomId);
          if (tool) writer.release(tool);
          toolPending.delete(raw.axiomId);
        }
        const receipt = pending.get(entry.message);
        if (receipt) { writer.release(receipt); pending.delete(entry.message); }
      }
      return undefined;
    },
  });
  return Object.freeze({
    attach: (publisher: Pick<AgentSession, "sessionManager" | "subscribe" | "dispose">) => {
      bridge.attachPublisher(publisher);
    },
    /** A warmed worker reuses its manager, not its previous run's overlays. */
    begin: () => {
      holder.close(writer); writer = holder.begin(); pending = new WeakMap(); toolFences = new Set(); toolPending = new Map();
      ready = live && bridge.active();
      const generation = ++epoch;
      return Object.freeze({
        active: () => ready && generation === epoch && bridge.active(),
        observe: (raw: object, message: ChatMessage) => {
          if (!ready || generation !== epoch || !bridge.active()) return;
          // Custom messages have a separate native producer. Do not manufacture
          // ordinary provenance for them, including displayed custom inputs.
          const role = (raw as { role?: unknown }).role;
          if (role !== "user" && role !== "assistant" && role !== "toolResult") return;
          if (role === "toolResult") toolFences.add(message.id);
          const old = pending.get(raw);
          if (old) writer.release(old);
          const receipt = writer.write(message);
          if (receipt) pending.set(raw, receipt);
        },
        /** Trusted tool_execution display, not an ordinary native-message claim.
         * The later ordinary toolResult replaces this same-ID value; only its
         * native completion releases it. Late tool callbacks cannot revive it. */
        observeTool: (message: ChatMessage) => {
          if (!ready || generation !== epoch || !bridge.active() || message.role !== "toolResult" || toolFences.has(message.id)) return;
          const receipt = writer.write(message);
          if (receipt) toolPending.set(message.id, receipt);
          if (!message.streaming) toolFences.add(message.id);
        },
        capture: (origins: ReadonlyMap<string, RunOrigin> = new Map()): CanonicalSourceCapture | undefined => {
          if (!ready || generation !== epoch || !bridge.active()) return;
          const overlay = holder.snapshot();
          // A completed message without native acknowledgement is not a current
          // finalized source. In particular an append failure must not look saved.
          if (overlay.some(item => !item.message.streaming)) return;
          const current = transcriptMessages(manager);
          const messages = new Map(current.map(message => [message.id, message]));
          for (const { message } of overlay) messages.set(message.id, message as ChatMessage);
          for (const [id, message] of messages) {
            const origin = message.runId && origins.get(message.runId);
            if (origin) messages.set(id, { ...message, runOrigin: origin });
          }
          const archive = historyProjection(manager, "canonical-live", origins, messages.values());
          return captureCanonicalSources({ archive, currentGroups: threadGroups([...messages.values()]),
            currentMessages: messages, transientMessages: new Map(overlay.map(item => [item.message.id, messages.get(item.message.id)!])) });
        },
        end: () => { if (generation === epoch) { ready = false; pending = new WeakMap(); toolFences.clear(); toolPending.clear(); holder.close(writer); } },
      });
    },
    dispose: () => { close(); bridge.revoke(); },
  });
}
export type CanonicalLiveSource = ReturnType<typeof prepareCanonicalLiveSource>;
export type CanonicalLiveRun = ReturnType<CanonicalLiveSource["begin"]>;
