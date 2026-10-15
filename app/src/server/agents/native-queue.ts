import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

// pi 1.1.0 exposes only next-turn peek and text-only session queue mirrors.
// Keep this version-bound read adapter isolated and fail closed on API drift.
// Mutations use public Agent APIs, synchronously, so consumption cannot race a recall.
function queues(session: AgentSession) {
  const agent = session.agent as unknown as {
    steeringQueue?: { messages?: AgentMessage[] };
    followUpQueue?: { messages?: AgentMessage[] };
  };
  const steer = agent.steeringQueue?.messages, followUp = agent.followUpQueue?.messages;
  if (!Array.isArray(steer) || !Array.isArray(followUp))
    throw Error("Unsupported pi queue layout");
  return { steer, followUp };
}
export function nativeQueuedMessages(session: AgentSession): AgentMessage[] {
  const { steer, followUp } = queues(session);
  return [...steer, ...followUp];
}
function inputId(message: AgentMessage): string | undefined {
  if (message.role !== "custom" || message.customType !== "axiom-append") return;
  const id = (message.details as { axiomInput?: unknown } | undefined)?.axiomInput;
  return typeof id === "string" ? id : undefined;
}
export function nativeInputs(session: AgentSession) {
  return Object.entries(queues(session)).flatMap(([mode, messages]) =>
    messages.flatMap((message) => {
      const id = inputId(message);
      return id ? [{ id, mode: mode as "steer" | "followUp" }] : [];
    }));
}
export function recallNativeInputs(session: AgentSession, ids: ReadonlySet<string>) {
  const removed: string[] = [];
  for (const [mode, messages] of Object.entries(queues(session))) {
    const keep = messages.filter((message) => {
      const id = inputId(message);
      if (!id || !ids.has(id)) return true;
      removed.push(id);
      return false;
    });
    if (keep.length === messages.length) continue;
    // Leave native user-message display mirrors intact. Only our ID-tagged
    // custom inputs are removed; result notifications/extensions are preserved.
    if (mode === "steer") {
      session.agent.clearSteeringQueue();
      for (const message of keep) session.agent.steer(message);
    } else {
      session.agent.clearFollowUpQueue();
      for (const message of keep) session.agent.followUp(message);
    }
  }
  return removed;
}
