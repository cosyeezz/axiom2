import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { ChatMessage } from "../shared/agent.js";
import { taskDisplayText } from "./task-output.js";
import { toolKey } from "./transcript.js";

type ToolEvent = Extract<AgentSessionEvent, { type: "tool_execution_start" | "tool_execution_update" | "tool_execution_end" }>;

/** One worker-run's trusted display adapter. Tool events are not native append
 * acknowledgements. Ordinary toolResult messages later supply that handoff.
 * Returns the existing legacy IPC shape while publishing the same full text. */
export function createCanonicalToolDisplay(runId: string, observe: (message: ChatMessage) => void, now = Date.now) {
  const running = new Map<string, { text: string; startedAt: number }>();
  return (event: ToolEvent) => {
    const id = toolKey(runId, event.toolCallId), old = running.get(id);
    const ended = event.type === "tool_execution_end";
    const result = event.type === "tool_execution_update" ? event.partialResult : ended ? event.result : undefined;
    const display = taskDisplayText(event.toolName, result?.details, ended && event.isError);
    const content: { type: "text"; text: string }[] | undefined = display !== undefined ? [{ type: "text", text: display }]
      : result?.content?.filter((item: any) => item.type === "text").map((item: any) => ({ type: "text", text: item.text }));
    const text = content?.map(item => item.text).join("\n") ?? old?.text ?? "";
    const startedAt = old?.startedAt ?? (ended ? undefined : now());
    const status = ended ? event.isError ? "failed" as const : "completed" as const : "running" as const;
    const durationMs = ended ? event.durationMs : undefined;
    if (ended) running.delete(id);
    else running.set(id, { text, startedAt: startedAt! });
    // Pi nested ctx.executeTool calls never append their own toolResult. Their
    // lifecycle belongs to the parent's native result, not an independent source.
    // Preserve legacy IPC below, but never wait for a nonexistent native ack.
    if (event.parentToolCallId === undefined)
      observe({ id: `tool-${id}`, runId, role: "toolResult", text, toolName: event.toolName, toolCallId: id,
        status, streaming: !ended, toolStartedAt: startedAt, durationMs });
    return { type: "tool" as const, id, name: event.toolName, durationMs, status, output: { content } };
  };
}
